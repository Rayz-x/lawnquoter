-- Privilege gaps: least-privilege EXECUTE, pending invites, webhook-only
-- payment intents, server-captured acceptance evidence, and crew denial of
-- prices, costs, and gate codes.
--
-- Version is 20261009105000 so this sorts after 20261009104008 (PR #9,
-- property_clear_geometry) and does not collide with PR #8, which also
-- used 20261009180000. That timestamp is in the future relative to the
-- hosted database and would break migration ordering.
--
-- quote_public is intentionally not replaced. An open branding migration
-- redefines that function; this file only adjusts its grants.
--
-- REBASE: PR #8 (acceptance NTE, 20261009180000_acceptance_not_to_exceed.sql)
-- also replaces public.quote_accept. Whichever of these two migrations lands
-- second must merge both function bodies. Keep this file's request-header
-- capture (ignore p_ip and p_user_agent; read x-forwarded-for and user-agent
-- from request.headers) together with PR #8's required signer email, the
-- not-to-exceed cap, the clause, and the acceptance hash. Do not drop either
-- side when resolving the conflict.

-- ---------------------------------------------------------------------------
-- Who may see prices and property-access secrets
-- ---------------------------------------------------------------------------
-- Office roles keep the access they have today. `crew` does not.
-- crew_lead is not the crew role; it still reads prices and gate codes.
create or replace function private.can_read_pricing(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(
    target_org,
    array['owner', 'admin', 'sales', 'dispatcher', 'crew_lead', 'read_only']::public.org_role[]
  );
$$;

-- Jobs and crew assignments are not in the schema yet. Until a job can point
-- at a property and a crew member, crew cannot read gate codes or access
-- notes at all. When assignments exist, this check should also allow crew
-- for properties on jobs assigned to auth.uid().
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
-- Quote and line-item money stays on the base tables so quote_public and the
-- integrity functions keep reading it. authenticated cannot select those
-- columns. Office reads the synced side tables; crew's policies match no rows.
-- ---------------------------------------------------------------------------
create table public.quote_line_item_amounts (
  line_item_id uuid primary key references public.quote_line_items(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  price numeric not null default 0,
  hours numeric not null default 0,
  cost numeric not null default 0,
  range_low numeric,
  range_high numeric
);

create table public.quote_amounts (
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  deposit_amount numeric
);

create trigger quote_amounts_same_org
  before insert or update of org_id, quote_id on public.quote_amounts
  for each row execute function private.child_org_guard('quotes', 'quote_id');

create or replace function private.sync_quote_line_item_amounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.quote_line_item_amounts (
    line_item_id, org_id, price, hours, cost, range_low, range_high
  ) values (
    new.id, new.org_id, new.price, new.hours, new.cost, new.range_low, new.range_high
  )
  on conflict (line_item_id) do update
    set org_id = excluded.org_id,
        price = excluded.price,
        hours = excluded.hours,
        cost = excluded.cost,
        range_low = excluded.range_low,
        range_high = excluded.range_high;
  return new;
end;
$$;

create trigger quote_line_items_sync_amounts
  after insert or update of price, hours, cost, range_low, range_high, org_id
  on public.quote_line_items
  for each row execute function private.sync_quote_line_item_amounts();

create or replace function private.sync_quote_amounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.quote_amounts (quote_id, org_id, deposit_amount)
  values (new.id, new.org_id, new.deposit_amount)
  on conflict (quote_id) do update
    set org_id = excluded.org_id,
        deposit_amount = excluded.deposit_amount;
  return new;
end;
$$;

create trigger quotes_sync_amounts
  after insert or update of deposit_amount, org_id on public.quotes
  for each row execute function private.sync_quote_amounts();

insert into public.quote_line_item_amounts (line_item_id, org_id, price, hours, cost, range_low, range_high)
select id, org_id, price, hours, cost, range_low, range_high
from public.quote_line_items;

insert into public.quote_amounts (quote_id, org_id, deposit_amount)
select id, org_id, deposit_amount
from public.quotes;

alter table public.quote_line_item_amounts enable row level security;
alter table public.quote_line_item_amounts force row level security;
alter table public.quote_amounts enable row level security;
alter table public.quote_amounts force row level security;

create policy quote_line_item_amounts_select on public.quote_line_item_amounts
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
create policy quote_amounts_select on public.quote_amounts
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

grant select on public.quote_line_item_amounts, public.quote_amounts to authenticated;
grant all on public.quote_line_item_amounts, public.quote_amounts to service_role;

-- A table-level SELECT covers every column, so a column revoke is a no-op
-- while that grant remains. Drop table SELECT, then grant the non-money columns.
revoke select on public.quote_line_items from public, anon, authenticated;
grant select (
  id, org_id, version_id, section_id, service_id, name, description, state,
  option_group, option_tier, qty, unit, photo_url, notes_customer, notes_crew,
  selected, sort
) on public.quote_line_items to authenticated;

revoke select on public.quotes from public, anon, authenticated;
grant select (
  id, org_id, account_id, property_id, template_id, number, title, status,
  public_token, current_version, expires_at, sent_at, viewed_at, intro,
  notes_customer, notes_internal, created_by, created_at, updated_at
) on public.quotes to authenticated;

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

grant execute on function private.can_read_pricing(uuid) to authenticated, service_role;
grant execute on function private.can_read_property_access(uuid, uuid) to authenticated, service_role;
grant execute on function private.handle_new_auth_user() to supabase_auth_admin;

-- Live-only drift. The function is not created here; revoke it when present.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon;
  end if;
end
$$;

-- A schema-scoped revoke does not replace Postgres' built-in
-- GRANT EXECUTE TO PUBLIC. A global default ACL does.
alter default privileges revoke execute on functions from public;
