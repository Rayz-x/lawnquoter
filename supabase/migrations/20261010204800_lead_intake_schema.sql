-- Lead intake schema (L01 / #116).
--
-- Dusty: merging applies this migration to the hosted database. Do not merge
-- until Dusty has reviewed and approved it.
--
-- Model only. Later tickets add the public intake function, hosted form,
-- geocode gates, emails, and inbox UI. This file adds:
--   * enums lead_request_status / lead_lost_reason
--   * lead_requests + append-only lead_activities
--   * org settings helpers for response target, default assignee, service-area
--     ZIPs, retention, form services, consent text, and form slug
--   * RLS: office via can_read_office_records / can_edit_customers.
--     Crew and anon get nothing. Public writes only via a later intake RPC.

-- ---------------------------------------------------------------------------
-- Same-org allowlist: lead_activities → lead_requests
-- ---------------------------------------------------------------------------
create or replace function private.assert_same_org(p_table text, p_id text, p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  if p_id is null or p_id = '' then
    return;
  end if;
  if p_table not in (
    'accounts', 'properties', 'measurements', 'quotes', 'quote_versions',
    'quote_sections', 'quote_line_items', 'services', 'price_lists',
    'agreements', 'jobs', 'crews', 'routes', 'visits',
    'visit_tasks', 'invoices', 'payments',
    'lead_requests'
  ) then
    raise exception 'unsupported parent table %', p_table using errcode = '0A000';
  end if;

  execute format(
    'select exists (select 1 from public.%I where id = $1::uuid and org_id = $2)',
    p_table
  ) into ok using p_id, p_org;

  if not coalesce(ok, false) then
    raise exception '% must belong to the same org', p_table using errcode = '23503';
  end if;
end;
$$;

revoke all on function private.assert_same_org(text, text, uuid) from public, anon;
grant execute on function private.assert_same_org(text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.lead_request_status as enum (
  'new', 'contacted', 'quoted', 'won', 'lost', 'spam'
);

create type public.lead_lost_reason as enum (
  'price', 'competitor', 'no_response', 'out_of_area', 'not_a_fit', 'spam', 'other'
);

-- ---------------------------------------------------------------------------
-- lead_requests
-- ---------------------------------------------------------------------------
create table public.lead_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  status public.lead_request_status not null default 'new',

  -- Contact
  contact_name text not null check (length(btrim(contact_name)) between 1 and 200),
  phone text check (phone is null or length(btrim(phone)) between 3 and 40),
  email text check (email is null or length(btrim(email)) between 3 and 320),
  preferred_contact text check (
    preferred_contact is null
    or preferred_contact in ('phone', 'email', 'either')
  ),
  is_business boolean not null default false,

  -- Typed address (always kept) + optional geocode result
  address_typed text not null check (length(btrim(address_typed)) between 1 and 500),
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text not null default 'US',
  location extensions.geography(Point, 4326),
  geocode_score numeric check (geocode_score is null or geocode_score between 0 and 1),
  geocode_attribution text,
  geocode_raw jsonb,
  needs_address_check boolean not null default false,
  out_of_area boolean not null default false,

  -- Requested services + note
  services text[] not null default '{}',
  note text check (note is null or length(btrim(note)) between 1 and 5000),

  -- Attribution / source (aligned with accounts.lead_source picklist)
  source text,
  source_other text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer text,
  landing_page text,

  -- Consent (SMS opt-in separate from submit)
  sms_consent boolean not null default false,
  consent_text_version text,
  consent_at timestamptz,
  consent_ip_hash text,
  consent_ua text,

  -- Abuse / spam signals
  spam_score numeric not null default 0 check (spam_score >= 0),
  ip_hash text,

  -- Assignment / follow-up
  assignee_id uuid references public.profiles(id) on delete set null,
  next_follow_up_on date,
  first_contacted_at timestamptz,
  stale boolean not null default false,

  -- Lost
  lost_reason public.lead_lost_reason,
  lost_note text check (lost_note is null or length(btrim(lost_note)) between 1 and 2000),

  -- Links after convert
  account_id uuid references public.accounts(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,

  -- Photo object keys (bucket + policies land in L13)
  photo_paths text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lead_requests_contact_required_chk check (
    phone is not null or email is not null
  ),
  constraint lead_requests_services_limit_chk check (
    cardinality(services) <= 32
  ),
  constraint lead_requests_photo_paths_limit_chk check (
    cardinality(photo_paths) <= 3
  ),
  constraint lead_requests_lost_fields_chk check (
    (
      status <> 'lost'::public.lead_request_status
      and lost_reason is null
      and lost_note is null
    )
    or (
      status = 'lost'::public.lead_request_status
      and lost_reason is not null
      and (
        lost_reason <> 'other'::public.lead_lost_reason
        or lost_note is not null
      )
    )
  ),
  constraint lead_requests_first_contacted_status_chk check (
    first_contacted_at is null
    or status <> 'new'::public.lead_request_status
  )
);

comment on table public.lead_requests is
  'Inbound quote requests. Anon has no direct write; intake uses a later SECURITY DEFINER RPC.';
comment on column public.lead_requests.address_typed is
  'Address as the requester typed it. Kept even when geocode fails or scores low.';
comment on column public.lead_requests.spam_score is
  'Abuse score from honeypot, fill-time, and rate-limit signals. Office may still review spam.';
comment on column public.lead_requests.photo_paths is
  'Storage object keys for up to 3 form photos. Bucket policies arrive in L13.';

create index lead_requests_org_status_created_idx
  on public.lead_requests (org_id, status, created_at desc);
create index lead_requests_org_assignee_idx
  on public.lead_requests (org_id, assignee_id, next_follow_up_on)
  where assignee_id is not null;
create index lead_requests_org_phone_idx
  on public.lead_requests (org_id, phone)
  where phone is not null;
create index lead_requests_org_email_idx
  on public.lead_requests (org_id, lower(email))
  where email is not null;
create index lead_requests_account_id_idx
  on public.lead_requests (account_id)
  where account_id is not null;
create index lead_requests_location_idx
  on public.lead_requests using gist (location)
  where location is not null;

create trigger lead_requests_set_updated_at
  before update on public.lead_requests
  for each row execute function private.set_updated_at();

create or replace function private.lead_requests_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_same_org('accounts', new.account_id::text, new.org_id);
  perform private.assert_same_org('properties', new.property_id::text, new.org_id);
  perform private.assert_same_org('quotes', new.quote_id::text, new.org_id);
  if new.assignee_id is not null then
    if not exists (
      select 1
      from public.memberships m
      where m.org_id = new.org_id
        and m.user_id = new.assignee_id
        and m.status = 'active'
    ) then
      raise exception 'assignee must be an active member of the org' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.lead_requests_before_write() from public, anon;
grant execute on function private.lead_requests_before_write() to authenticated, service_role;

create trigger lead_requests_before_write
  before insert or update of org_id, account_id, property_id, quote_id, assignee_id
  on public.lead_requests
  for each row execute function private.lead_requests_before_write();

-- ---------------------------------------------------------------------------
-- lead_activities (append-only)
-- ---------------------------------------------------------------------------
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lead_request_id uuid not null references public.lead_requests(id) on delete cascade,
  kind text not null check (length(btrim(kind)) between 1 and 80),
  summary text not null check (length(btrim(summary)) between 1 and 500),
  meta jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.lead_activities is
  'Append-only lead timeline. Authenticated roles may insert and select; no update/delete.';

create index lead_activities_lead_occurred_idx
  on public.lead_activities (lead_request_id, occurred_at desc);
create index lead_activities_org_occurred_idx
  on public.lead_activities (org_id, occurred_at desc);

create or replace function private.lead_activities_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_same_org('lead_requests', new.lead_request_id::text, new.org_id);
  return new;
end;
$$;

revoke all on function private.lead_activities_before_write() from public, anon;
grant execute on function private.lead_activities_before_write() to authenticated, service_role;

create trigger lead_activities_before_write
  before insert or update of org_id, lead_request_id on public.lead_activities
  for each row execute function private.lead_activities_before_write();

-- Append-only: block direct update/delete. Cascade deletes from lead_requests
-- (retention purge) are allowed via trigger depth, matching visit_events.
create or replace function private.lead_activities_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'lead_activities is append-only' using errcode = 'P0001';
end;
$$;

revoke all on function private.lead_activities_append_only() from public, anon;
grant execute on function private.lead_activities_append_only() to authenticated, service_role;

create trigger lead_activities_append_only
  before update or delete on public.lead_activities
  for each row execute function private.lead_activities_append_only();

-- ---------------------------------------------------------------------------
-- Org settings helpers (jsonb keys; absent = defaults below)
--   lead_response_target_minutes   integer  default 60
--   lead_default_assignee          text     default 'owner'
--                                   ('owner' or a profile uuid string)
--   lead_service_area_zips         text[]   default {}
--   lead_spam_retention_days       integer  default 30
--   lead_unconverted_retention_days integer default 365
--   lead_form_services             text[]   default {}
--   lead_consent_text_version      text     default 'v1'
--   lead_consent_text              text     default (built-in SMS consent line)
--   lead_form_slug                 text     default null (set when form enabled)
-- ---------------------------------------------------------------------------
create or replace function private.lead_response_target_minutes(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select (o.settings ->> 'lead_response_target_minutes')::integer
      from public.orgs o
      where o.id = p_org
        and o.settings ? 'lead_response_target_minutes'
        and (o.settings ->> 'lead_response_target_minutes') ~ '^[0-9]+$'
        and (o.settings ->> 'lead_response_target_minutes')::integer between 1 and 1440
    ),
    60
  );
$$;

create or replace function private.lead_default_assignee(p_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_setting text;
  v_id uuid;
begin
  select o.settings ->> 'lead_default_assignee'
  into v_setting
  from public.orgs o
  where o.id = p_org;

  if v_setting is not null
     and v_setting <> 'owner'
     and v_setting ~ '^[0-9a-f-]{36}$' then
    select m.user_id into v_id
    from public.memberships m
    where m.org_id = p_org
      and m.user_id = v_setting::uuid
      and m.status = 'active';
    if v_id is not null then
      return v_id;
    end if;
  end if;

  select m.user_id into v_id
  from public.memberships m
  where m.org_id = p_org
    and m.role = 'owner'::public.org_role
    and m.status = 'active'
  order by m.created_at
  limit 1;

  return v_id;
end;
$$;

create or replace function private.lead_service_area_zips(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select array(
        select jsonb_array_elements_text(o.settings -> 'lead_service_area_zips')
      )
      from public.orgs o
      where o.id = p_org
        and o.settings ? 'lead_service_area_zips'
        and jsonb_typeof(o.settings -> 'lead_service_area_zips') = 'array'
    ),
    '{}'::text[]
  );
$$;

create or replace function private.lead_spam_retention_days(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select (o.settings ->> 'lead_spam_retention_days')::integer
      from public.orgs o
      where o.id = p_org
        and o.settings ? 'lead_spam_retention_days'
        and (o.settings ->> 'lead_spam_retention_days') ~ '^[0-9]+$'
        and (o.settings ->> 'lead_spam_retention_days')::integer between 1 and 3650
    ),
    30
  );
$$;

create or replace function private.lead_unconverted_retention_days(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select (o.settings ->> 'lead_unconverted_retention_days')::integer
      from public.orgs o
      where o.id = p_org
        and o.settings ? 'lead_unconverted_retention_days'
        and (o.settings ->> 'lead_unconverted_retention_days') ~ '^[0-9]+$'
        and (o.settings ->> 'lead_unconverted_retention_days')::integer between 1 and 3650
    ),
    365
  );
$$;

create or replace function private.lead_form_services(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select array(
        select jsonb_array_elements_text(o.settings -> 'lead_form_services')
      )
      from public.orgs o
      where o.id = p_org
        and o.settings ? 'lead_form_services'
        and jsonb_typeof(o.settings -> 'lead_form_services') = 'array'
    ),
    '{}'::text[]
  );
$$;

create or replace function private.lead_consent_text_version(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(
      (
        select btrim(o.settings ->> 'lead_consent_text_version')
        from public.orgs o
        where o.id = p_org
          and o.settings ? 'lead_consent_text_version'
      ),
      ''
    ),
    'v1'
  );
$$;

create or replace function private.lead_consent_text(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(
      (
        select btrim(o.settings ->> 'lead_consent_text')
        from public.orgs o
        where o.id = p_org
          and o.settings ? 'lead_consent_text'
      ),
      ''
    ),
    'I agree to receive SMS updates about my request. Message and data rates may apply. Reply STOP to opt out.'
  );
$$;

create or replace function private.lead_form_slug(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    (
      select btrim(o.settings ->> 'lead_form_slug')
      from public.orgs o
      where o.id = p_org
        and o.settings ? 'lead_form_slug'
    ),
    ''
  );
$$;

revoke all on function private.lead_response_target_minutes(uuid) from public, anon;
revoke all on function private.lead_default_assignee(uuid) from public, anon;
revoke all on function private.lead_service_area_zips(uuid) from public, anon;
revoke all on function private.lead_spam_retention_days(uuid) from public, anon;
revoke all on function private.lead_unconverted_retention_days(uuid) from public, anon;
revoke all on function private.lead_form_services(uuid) from public, anon;
revoke all on function private.lead_consent_text_version(uuid) from public, anon;
revoke all on function private.lead_consent_text(uuid) from public, anon;
revoke all on function private.lead_form_slug(uuid) from public, anon;

grant execute on function private.lead_response_target_minutes(uuid) to authenticated, service_role;
grant execute on function private.lead_default_assignee(uuid) to authenticated, service_role;
grant execute on function private.lead_service_area_zips(uuid) to authenticated, service_role;
grant execute on function private.lead_spam_retention_days(uuid) to authenticated, service_role;
grant execute on function private.lead_unconverted_retention_days(uuid) to authenticated, service_role;
grant execute on function private.lead_form_services(uuid) to authenticated, service_role;
grant execute on function private.lead_consent_text_version(uuid) to authenticated, service_role;
grant execute on function private.lead_consent_text(uuid) to authenticated, service_role;
grant execute on function private.lead_form_slug(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.lead_requests enable row level security;
alter table public.lead_requests force row level security;
alter table public.lead_activities enable row level security;
alter table public.lead_activities force row level security;

-- No policies for anon: deny all. Public intake is a later SECURITY DEFINER RPC.

create policy lead_requests_select on public.lead_requests
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

create policy lead_requests_insert on public.lead_requests
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));

create policy lead_requests_update on public.lead_requests
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy lead_requests_delete on public.lead_requests
  for delete to authenticated
  using ((select private.is_org_admin(org_id)));

create policy lead_activities_select on public.lead_activities
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

create policy lead_activities_insert on public.lead_activities
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));

revoke all on public.lead_requests from public, anon;
revoke all on public.lead_activities from public, anon;

grant select, insert, update, delete on public.lead_requests to authenticated;
grant select, insert on public.lead_activities to authenticated;
revoke update, delete on public.lead_activities from public, anon, authenticated;
grant all on public.lead_requests, public.lead_activities to service_role;
