-- Privilege gaps: least-privilege EXECUTE, pending invites, webhook-only
-- payment intents, server-captured acceptance evidence, and field-role denial
-- of prices, costs, and gate codes.
--
-- Version is 20261009105000 so this sorts after 20261009104008 (PR #9,
-- property_clear_geometry) and does not collide with PR #8, which also
-- used 20261009180000. That timestamp is in the future relative to the
-- hosted database and would break migration ordering.
--
-- REBASE: PR #8 (acceptance NTE, 20261009180000_acceptance_not_to_exceed.sql)
-- also replaces public.quote_accept. Whichever of these two migrations lands
-- second must merge both function bodies. Keep this file's request-header
-- capture (ignore p_ip and p_user_agent; read x-forwarded-for and user-agent
-- from request.headers) together with PR #8's required signer email, the
-- not-to-exceed cap, the clause, and the acceptance hash. Do not drop either
-- side when resolving the conflict.
--
-- REBASE: PR #6 also replaces public.quote_public. Whichever lands second
-- must keep this file's refusal: an authenticated crew or crew_lead member of
-- the quote's org gets null, and therefore no prices, even with the public
-- token. Anon customers still receive the public proposal.
--
-- New helper functions must be explicitly granted to authenticated and
-- service_role. The default privileges at the bottom revoke EXECUTE from
-- anon and PUBLIC, and authenticated inherited function EXECUTE through
-- PUBLIC. A function an RLS policy calls needs that grant or the policy fails.

-- ---------------------------------------------------------------------------
-- Who may see prices and property-access secrets
-- ---------------------------------------------------------------------------
-- Office roles (owner, admin, sales, dispatcher, read_only) read prices and
-- gate codes. crew and crew_lead are the field roles: one phone per truck,
-- run by the crew lead. They see neither.
create or replace function private.can_read_pricing(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(
    target_org,
    array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[]
  );
$$;

-- Jobs and crew assignments are not in the schema yet. Until a job can point
-- at a property and a crew member, crew and crew_lead cannot read gate codes
-- or access notes at all. When assignments exist, this check should also
-- allow those field roles for properties on jobs assigned to auth.uid().
create or replace function private.can_read_property_access(target_org uuid, target_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_property is not null
     and private.can_read_pricing(target_org);
$$;

drop policy if exists price_lists_select on public.price_lists;
create policy price_lists_select on public.price_lists
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists pricing_rules_select on public.pricing_rules;
create policy pricing_rules_select on public.pricing_rules
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists labor_rates_select on public.labor_rates;
create policy labor_rates_select on public.labor_rates
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists equipment_rates_select on public.equipment_rates;
create policy equipment_rates_select on public.equipment_rates
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists payment_intents_select on public.payment_intents;
create policy payment_intents_select on public.payment_intents
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

-- ---------------------------------------------------------------------------
-- Gate codes and access notes. Crew sees none of these rows.
-- ---------------------------------------------------------------------------
create table public.property_access (
  property_id uuid primary key references public.properties(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  gate_code text,
  access_notes text
);

insert into public.property_access (property_id, org_id, gate_code, access_notes)
select id, org_id, gate_code, access_notes
from public.properties
where gate_code is not null or access_notes is not null;

alter table public.properties
  drop column gate_code,
  drop column access_notes;

create trigger property_access_same_org
  before insert or update of org_id, property_id on public.property_access
  for each row execute function private.child_org_guard('properties', 'property_id');

alter table public.property_access enable row level security;
alter table public.property_access force row level security;

create policy property_access_select on public.property_access
  for select to authenticated
  using ((select private.can_read_property_access(org_id, property_id)));
create policy property_access_insert on public.property_access
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy property_access_update on public.property_access
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy property_access_delete on public.property_access
  for delete to authenticated
  using ((select private.can_edit_customers(org_id)));

grant select, insert, update, delete on public.property_access to authenticated;
grant all on public.property_access to service_role;

-- ---------------------------------------------------------------------------
-- Field roles get no quote, acceptance, or audit rows. There is no jobs
-- table and no crew UI reads a quote, including notes_crew, so nothing is
-- carved back out. Office keeps the original table SELECT, so select('*')
-- and PostgREST RETURNING keep working and later columns stay visible.
-- ---------------------------------------------------------------------------
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists quote_versions_select on public.quote_versions;
create policy quote_versions_select on public.quote_versions
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists quote_sections_select on public.quote_sections;
create policy quote_sections_select on public.quote_sections
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists quote_line_items_select on public.quote_line_items;
create policy quote_line_items_select on public.quote_line_items
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists acceptances_select on public.acceptances;
create policy acceptances_select on public.acceptances
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

-- Hiding public_token is not enough: a logged-in field role that already
-- has the token can still call this anon RPC. Return null before any price
-- is built, and before the viewed/expired writes.
create or replace function public.quote_public(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  o public.orgs;
begin
  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed') then
    return null;
  end if;

  if auth.uid() is not null and exists (
    select 1
    from public.memberships m
    where m.org_id = q.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('crew', 'crew_lead')
  ) then
    return null;
  end if;

  if q.expires_at is not null
     and q.expires_at < current_date
     and q.status not in ('accepted', 'declined', 'expired') then
    update public.quotes set status = 'expired' where id = q.id;
    q.status := 'expired';
  end if;

  select * into v from public.quote_versions where quote_id = q.id and version = q.current_version;
  select * into o from public.orgs where id = q.org_id;

  if q.status = 'sent' then
    update public.quotes
    set status = 'viewed', viewed_at = coalesce(viewed_at, now())
    where id = q.id;
    q.status := 'viewed';
  end if;

  return jsonb_build_object(
    'title', q.title,
    'number', q.number,
    'intro', q.intro,
    'notes_customer', q.notes_customer,
    'expires_at', q.expires_at,
    'status', q.status,
    'org', jsonb_build_object('name', o.name, 'phone', o.phone, 'email', o.email, 'brand_color', o.brand_color),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'sort', s.sort) order by s.sort)
      from public.quote_sections s where s.version_id = v.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'section_id', i.section_id, 'name', i.name, 'description', i.description,
        'state', i.state, 'option_group', i.option_group, 'option_tier', i.option_tier,
        'qty', i.qty, 'unit', i.unit, 'price', i.price, 'range_low', i.range_low, 'range_high', i.range_high,
        'photo_url', i.photo_url, 'notes_customer', i.notes_customer, 'selected', i.selected, 'sort', i.sort
      ) order by i.sort)
      from public.quote_line_items i where i.version_id = v.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Acceptance evidence comes from request headers, not RPC arguments.
-- ---------------------------------------------------------------------------
create or replace function public.quote_accept(
  p_token uuid,
  p_signer_name text,
  p_signer_email text default null,
  p_disclosure boolean default false,
  p_user_agent text default null,
  p_ip text default null,
  p_selected uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  v_offer_hash text;
  v_hash text;
  v_event_hash text;
  v_ip inet;
  v_ids jsonb;
  v_total numeric;
  v_headers jsonb := '{}'::jsonb;
  v_forwarded text;
  v_ua text;
begin
  -- Arguments are ignored so a direct PostgREST call cannot forge evidence.
  perform p_user_agent, p_ip;

  if coalesce(p_disclosure, false) is not true then
    raise exception 'ESIGN disclosure must be accepted' using errcode = '22023';
  end if;
  if p_signer_name is null or length(trim(p_signer_name)) < 2 then
    raise exception 'signer name required' using errcode = '22023';
  end if;

  begin
    if coalesce(current_setting('request.headers', true), '') <> '' then
      v_headers := current_setting('request.headers', true)::jsonb;
    end if;
  exception
    when others then
      v_headers := '{}'::jsonb;
  end;

  v_forwarded := nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '');
  if v_forwarded is not null then
    begin
      v_ip := v_forwarded::inet;
    exception
      when invalid_text_representation then
        v_ip := null;
    end;
  end if;
  v_ua := nullif(btrim(v_headers ->> 'user-agent'), '');

  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed', 'declined') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.expires_at is not null and q.expires_at < current_date and q.status <> 'accepted' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'expired' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'accepted' then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
  end if;

  select * into v
  from public.quote_versions
  where quote_id = q.id and version = q.current_version
  for update;

  v_offer_hash := private.freeze_quote_version(v.id);

  select coalesce(jsonb_agg(item_id order by item_id), '[]'::jsonb), coalesce(sum(price), 0)
    into v_ids, v_total
  from private.resolve_quote_selection(v.id, p_selected);

  v_hash := private.sha256_hex(v_offer_hash || ':' || v_ids::text);

  insert into public.acceptances (
    org_id, quote_id, version, method, signer_name, signer_email,
    document_hash, disclosure_accepted, ip, user_agent, selections, accepted_total
  ) values (
    q.org_id, q.id, q.current_version, 'click', trim(p_signer_name), nullif(btrim(coalesce(p_signer_email, '')), ''),
    v_hash, true, v_ip, v_ua, v_ids, v_total
  );

  v_event_hash := private.append_quote_audit(
    q.org_id,
    q.id,
    'quote.accepted',
    jsonb_build_object(
      'signer', trim(p_signer_name),
      'email', nullif(btrim(coalesce(p_signer_email, '')), ''),
      'version', q.current_version,
      'document_hash', v_hash,
      'selections', v_ids,
      'accepted_total', v_total,
      'ip', v_ip::text
    )
  );

  update public.quotes set status = 'accepted' where id = q.id;

  return jsonb_build_object(
    'ok', true,
    'document_hash', v_hash,
    'event_hash', v_event_hash,
    'accepted_total', v_total
  );
exception
  when unique_violation then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pending invites. Membership is created only when the invitee accepts.
-- ---------------------------------------------------------------------------
create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  role public.org_role not null,
  token_hash text not null unique,
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_invites_email_lower check (email = lower(email)),
  constraint org_invites_not_owner check (role <> 'owner')
);

create unique index org_invites_one_pending
  on public.org_invites (org_id, email)
  where status = 'pending';

create index org_invites_org_status_idx on public.org_invites (org_id, status);

create trigger org_invites_set_updated_at
  before update on public.org_invites
  for each row execute function private.set_updated_at();

alter table public.org_invites enable row level security;
alter table public.org_invites force row level security;

create policy org_invites_select_org on public.org_invites
  for select to authenticated
  using ((select private.is_org_member(org_id)));

create policy org_invites_select_invitee on public.org_invites
  for select to authenticated
  using (
    status = 'pending'
    and expires_at > now()
    and lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

revoke all on public.org_invites from anon, authenticated;
grant select (
  id, org_id, email, role, status, expires_at, invited_by, accepted_by, accepted_at, created_at, updated_at
) on public.org_invites to authenticated;
grant all on public.org_invites to service_role;

-- pgcrypto lives in extensions on Supabase and in public on a stock cluster.
create or replace function private.random_hex(nbytes integer)
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select encode(gen_random_bytes(nbytes), 'hex');
$$;

create or replace function public.create_org_invite(p_email text, p_role public.org_role)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := private.current_org_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = v_org
      and m.user_id = v_uid
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'only owners and admins can invite' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'transfer ownership from the member list instead' using errcode = '22023';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'enter a valid email' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.org_id = v_org
      and m.status = 'active'
      and lower(p.email) = v_email
  ) then
    raise exception 'that person is already a member' using errcode = '23505';
  end if;

  v_token := private.random_hex(32);
  v_hash := private.sha256_hex(v_token);

  select id into v_id
  from public.org_invites
  where org_id = v_org and email = v_email and status = 'pending';

  if v_id is null then
    insert into public.org_invites (org_id, email, role, token_hash, status, expires_at, invited_by)
    values (v_org, v_email, p_role, v_hash, 'pending', v_expires, v_uid)
    returning id into v_id;
  else
    update public.org_invites
      set role = p_role,
          token_hash = v_hash,
          expires_at = v_expires,
          invited_by = v_uid
    where id = v_id;
  end if;

  return jsonb_build_object('invite_id', v_id, 'token', v_token, 'expires_at', v_expires);
end;
$$;

create or replace function public.accept_org_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v public.org_invites;
  v_membership uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  v_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  if v_email = '' then
    select lower(btrim(coalesce(email, ''))) into v_email
    from public.profiles
    where id = v_uid;
  end if;

  select * into v
  from public.org_invites
  where token_hash = private.sha256_hex(btrim(p_token))
  for update;

  if not found or v.status <> 'pending' then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if v.expires_at <= now() then
    update public.org_invites set status = 'expired' where id = v.id;
    raise exception 'invite expired' using errcode = '22023';
  end if;
  if v_email = '' or v_email <> v.email then
    raise exception 'this invite was sent to a different email' using errcode = '42501';
  end if;

  insert into public.memberships (org_id, user_id, role, status, invited_email)
  values (v.org_id, v_uid, v.role, 'active', v.email)
  on conflict (org_id, user_id) do update
    set status = 'active',
        invited_email = excluded.invited_email,
        role = case
          when public.memberships.role = 'owner' then public.memberships.role
          else excluded.role
        end
  returning id into v_membership;

  update public.org_invites
    set status = 'accepted',
        accepted_by = v_uid,
        accepted_at = now()
  where id = v.id;

  update public.profiles
    set active_org_id = v.org_id
  where id = v_uid and active_org_id is null;

  return v_membership;
end;
$$;

create or replace function public.revoke_org_invite(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.org_invites;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v from public.org_invites where id = p_id for update;
  if not found or v.status <> 'pending' then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = v.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'only owners and admins can revoke an invite' using errcode = '42501';
  end if;
  update public.org_invites set status = 'revoked' where id = v.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- payment_intents: select for members, writes only for service_role (webhook).
-- ---------------------------------------------------------------------------
drop policy if exists payment_intents_write on public.payment_intents;

revoke insert, update, delete on public.payment_intents from public, anon, authenticated;
grant select on public.payment_intents to authenticated;
grant all on public.payment_intents to service_role;

alter table public.payment_intents
  add column if not exists stripe_event_id text;

create unique index if not exists payment_intents_stripe_event_id_key
  on public.payment_intents (stripe_event_id)
  where stripe_event_id is not null;

create unique index if not exists payment_intents_stripe_payment_intent_id_key
  on public.payment_intents (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- ---------------------------------------------------------------------------
-- EXECUTE: anon and PUBLIC lose security-definer functions they should not
-- call. The public proposal RPCs stay granted to anon and authenticated.
-- The access-token hook stays granted only to supabase_auth_admin.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private')
      and not (
        n.nspname = 'public'
        and p.proname in ('quote_public', 'quote_accept', 'quote_decline')
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon',
      fn.schema_name,
      fn.function_name,
      fn.args
    );
  end loop;
end
$$;

revoke execute on function public.quote_public(uuid) from public;
revoke execute on function public.quote_accept(uuid, text, text, boolean, text, text, uuid[]) from public;
revoke execute on function public.quote_decline(uuid, text) from public;

grant execute on function public.quote_public(uuid) to anon, authenticated;
grant execute on function public.quote_accept(uuid, text, text, boolean, text, text, uuid[]) to anon, authenticated;
grant execute on function public.quote_decline(uuid, text) to anon, authenticated;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

grant execute on function public.create_org(text, text, text) to authenticated;
grant execute on function public.set_active_org(uuid) to authenticated;
grant execute on function public.quote_send(uuid) to authenticated;
grant execute on function public.quote_revise(uuid) to authenticated;
grant execute on function public.create_org_invite(text, public.org_role) to authenticated;
grant execute on function public.accept_org_invite(text) to authenticated;
grant execute on function public.revoke_org_invite(uuid) to authenticated;

-- Policy helpers. The definer sweep above removes PUBLIC from security
-- definer functions. The invoker helpers never entered that sweep, so revoke
-- PUBLIC here too, then grant the roles that policies run as.
revoke execute on function private.current_org_id() from public, anon;
revoke execute on function private.current_org_role() from public, anon;
revoke execute on function private.is_org_admin(uuid) from public, anon;
revoke execute on function private.can_edit_customers(uuid) from public, anon;
revoke execute on function private.can_edit_pricing(uuid) from public, anon;

grant execute on function private.current_org_id() to authenticated, service_role;
grant execute on function private.current_org_role() to authenticated, service_role;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated, service_role;
grant execute on function private.is_org_admin(uuid) to authenticated, service_role;
grant execute on function private.can_edit_customers(uuid) to authenticated, service_role;
grant execute on function private.can_edit_pricing(uuid) to authenticated, service_role;
grant execute on function private.can_read_pricing(uuid) to authenticated, service_role;
grant execute on function private.can_read_property_access(uuid, uuid) to authenticated, service_role;
grant execute on function private.handle_new_auth_user() to supabase_auth_admin;

-- Security invoker, so the definer sweep above does not touch it. Hosted
-- default privileges still granted anon EXECUTE. authenticated keeps its grant.
revoke execute on function public.property_clear_geometry(uuid) from anon;

-- Live-only drift. The function is not created here; revoke it when present.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon;
  end if;
end
$$;

-- Future functions are not executable by anon or PUBLIC, so authenticated
-- cannot call a new helper until it is granted. Grant new helpers to
-- authenticated and service_role. quote_public, quote_accept, and
-- quote_decline keep the explicit grants above.
-- A schema-scoped revoke does not replace Postgres' built-in GRANT EXECUTE
-- TO PUBLIC, so the global default ACL covers that case too.
alter default privileges in schema public revoke execute on functions from anon, public;
alter default privileges revoke execute on functions from anon, public;
