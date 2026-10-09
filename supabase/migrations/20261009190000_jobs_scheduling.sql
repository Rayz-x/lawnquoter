-- Jobs and scheduling (build steps 9–10).
--
-- Tables, crew-scoped reads, RLS, and the office RPCs that convert an
-- accepted quote, generate visits, assign, reorder, publish, and create crews.
-- This file does not create time_entries, visit_photos, enhancement_requests,
-- visit_events, crew_day_pack, or crew_sync.
--
-- Money stays on quotes. These tables store budget_minutes only.
-- An after photo is required on every job and visit (no opt-out).
--
-- Depends on 20261009130000_privilege_gaps.sql (PR #10). That migration moves
-- properties.gate_code and properties.access_notes onto public.property_access
-- and creates private.can_read_property_access(uuid, uuid). Its placeholder is
-- `target_property is not null and can_read_pricing(org)`. can_read_pricing
-- allows owner, admin, sales, dispatcher, and read_only, and excludes crew
-- and crew_lead. This file does not create property_access and does not move
-- those columns. It replaces the helper only when that function already
-- exists, so the file still applies if the helper is absent:
--   * owner, admin, sales, dispatcher, and read_only still read every property
--   * crew and crew_lead read property_access only for a property on a
--     non-draft visit routed to a crew they belong to, scheduled within the
--     org's today ± 1 day
-- Quote price policies from #10 are left alone. can_read_pricing is not changed.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.agreement_kind as enum ('one_time', 'recurring');
create type public.agreement_frequency as enum ('weekly', 'biweekly', 'monthly', 'custom');
create type public.agreement_status as enum ('active', 'paused', 'ended');

create type public.job_status as enum (
  'unscheduled', 'scheduled', 'in_progress', 'completed', 'cancelled'
);

create type public.route_status as enum ('draft', 'published', 'in_progress', 'done');

create type public.visit_status as enum (
  'scheduled', 'in_progress', 'paused', 'completed', 'skipped', 'cant_complete', 'cancelled'
);

create type public.visit_skip_reason as enum (
  'gate_locked', 'dog_loose', 'customer_skip', 'weather', 'equipment', 'unsafe', 'other'
);

-- ---------------------------------------------------------------------------
-- Agreements
-- service_kind is text, not the catalog enum, so snow / irrigation / fert
-- program types can be added without an enum migration.
-- ---------------------------------------------------------------------------
create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  quote_version_id uuid references public.quote_versions(id) on delete set null,
  kind public.agreement_kind not null,
  service_kind text,
  frequency public.agreement_frequency,
  start_date date not null,
  end_date date,
  preferred_dow smallint,
  status public.agreement_status not null default 'active',
  notes_office text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agreements_service_kind_len check (
    service_kind is null or length(btrim(service_kind)) between 1 and 40
  ),
  constraint agreements_preferred_dow_range check (
    preferred_dow is null or preferred_dow between 0 and 6
  ),
  constraint agreements_end_after_start check (
    end_date is null or end_date >= start_date
  )
);

create index agreements_org_id_idx on public.agreements (org_id);
create index agreements_account_id_idx on public.agreements (account_id);
create index agreements_property_id_idx on public.agreements (property_id);
create index agreements_quote_id_idx on public.agreements (quote_id);
create index agreements_quote_version_id_idx on public.agreements (quote_version_id);
create index agreements_org_status_idx on public.agreements (org_id, status);

create trigger agreements_set_updated_at
  before update on public.agreements
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agreement_id uuid references public.agreements(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  status public.job_status not null default 'unscheduled',
  require_after_photo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_require_after_photo_always check (require_after_photo)
);

create index jobs_org_id_idx on public.jobs (org_id);
create index jobs_agreement_id_idx on public.jobs (agreement_id);
create index jobs_property_id_idx on public.jobs (property_id);
create index jobs_quote_id_idx on public.jobs (quote_id);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Crews
-- ---------------------------------------------------------------------------
create table public.crews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  default_lead_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crews_org_id_idx on public.crews (org_id);
create index crews_default_lead_id_idx on public.crews (default_lead_id);

create table public.crew_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crew_id, profile_id)
);

create index crew_members_org_id_idx on public.crew_members (org_id);
create index crew_members_profile_id_idx on public.crew_members (profile_id);

create trigger crews_set_updated_at
  before update on public.crews
  for each row execute function private.set_updated_at();

create trigger crew_members_set_updated_at
  before update on public.crew_members
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Routes and visits
-- One route per crew per day. Visits stay unassigned until route_id is set.
-- client_id is the crew client's idempotency key (unique per org when set).
-- ---------------------------------------------------------------------------
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete restrict,
  date date not null,
  status public.route_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, crew_id, date)
);

create index routes_crew_id_idx on public.routes (crew_id);

create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function private.set_updated_at();

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agreement_id uuid references public.agreements(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  route_id uuid references public.routes(id) on delete set null,
  sort integer not null default 0,
  scheduled_date date not null,
  window_start time,
  window_end time,
  status public.visit_status not null default 'scheduled',
  started_at timestamptz,
  completed_at timestamptz,
  crew_size integer not null default 1,
  budget_minutes integer,
  skip_reason public.visit_skip_reason,
  note_office text,
  require_after_photo boolean not null default true,
  reopen_until timestamptz,
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visits_crew_size_positive check (crew_size >= 1),
  constraint visits_budget_minutes_nonnegative check (
    budget_minutes is null or budget_minutes >= 0
  ),
  constraint visits_window_order check (
    window_end is null or window_start is null or window_end >= window_start
  ),
  constraint visits_skip_reason_status check (
    skip_reason is null or status in ('skipped', 'cant_complete')
  ),
  constraint visits_require_after_photo_always check (require_after_photo)
);

create index visits_org_id_idx on public.visits (org_id);
create index visits_agreement_id_idx on public.visits (agreement_id);
create index visits_job_id_idx on public.visits (job_id);
create index visits_property_id_idx on public.visits (property_id);
create index visits_route_id_idx on public.visits (route_id);
create index visits_org_scheduled_idx on public.visits (org_id, scheduled_date);

-- Recurring generation is idempotent: one non-cancelled visit per agreement
-- per day, and (when the visit is not tied to an agreement) per job per day.
-- A later revision of this file adds the generator; these indexes are the key.
create unique index visits_one_open_per_agreement_day
  on public.visits (org_id, agreement_id, scheduled_date)
  where agreement_id is not null
    and status <> 'cancelled'::public.visit_status;

create unique index visits_one_open_per_job_day
  on public.visits (org_id, job_id, scheduled_date)
  where agreement_id is null
    and status <> 'cancelled'::public.visit_status;

create unique index visits_org_client_id_key
  on public.visits (org_id, client_id)
  where client_id is not null;

create trigger visits_set_updated_at
  before update on public.visits
  for each row execute function private.set_updated_at();

create table public.visit_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 200),
  quantity_text text,
  source_line_item_id uuid references public.quote_line_items(id) on delete set null,
  is_extra boolean not null default false,
  sort integer not null default 0,
  done_at timestamptz,
  not_done_reason text,
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index visit_tasks_org_id_idx on public.visit_tasks (org_id);
create index visit_tasks_visit_id_idx on public.visit_tasks (visit_id);
create index visit_tasks_source_line_item_id_idx on public.visit_tasks (source_line_item_id);

create unique index visit_tasks_org_client_id_key
  on public.visit_tasks (org_id, client_id)
  where client_id is not null;

create trigger visit_tasks_set_updated_at
  before update on public.visit_tasks
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Same-org parents. Profiles have no org_id; crew leads and members must be
-- active members of the row's org instead.
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
    'agreements', 'jobs', 'crews', 'routes', 'visits'
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

revoke all on function private.assert_same_org(text, text, uuid) from public;
grant execute on function private.assert_same_org(text, text, uuid) to authenticated, service_role;

create or replace function private.assert_active_member(p_org uuid, p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user is null then
    return;
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org
      and m.user_id = p_user
      and m.status = 'active'
  ) then
    raise exception 'profile must be an active member of the org' using errcode = '23503';
  end if;
end;
$$;

revoke all on function private.assert_active_member(uuid, uuid) from public, anon;
grant execute on function private.assert_active_member(uuid, uuid) to authenticated, service_role;

create or replace function private.crews_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_active_member(new.org_id, new.default_lead_id);
  return new;
end;
$$;

create trigger crews_before_write
  before insert or update of org_id, default_lead_id on public.crews
  for each row execute function private.crews_before_write();

create or replace function private.crew_members_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_active_member(new.org_id, new.profile_id);
  return new;
end;
$$;

create trigger crew_members_before_write
  before insert or update of org_id, profile_id on public.crew_members
  for each row execute function private.crew_members_before_write();

create trigger agreements_account_org
  before insert or update of org_id, account_id on public.agreements
  for each row execute function private.child_org_guard('accounts', 'account_id');
create trigger agreements_property_org
  before insert or update of org_id, property_id on public.agreements
  for each row execute function private.child_org_guard('properties', 'property_id');
create trigger agreements_quote_org
  before insert or update of org_id, quote_id on public.agreements
  for each row execute function private.child_org_guard('quotes', 'quote_id');
create trigger agreements_quote_version_org
  before insert or update of org_id, quote_version_id on public.agreements
  for each row execute function private.child_org_guard('quote_versions', 'quote_version_id');

create trigger jobs_agreement_org
  before insert or update of org_id, agreement_id on public.jobs
  for each row execute function private.child_org_guard('agreements', 'agreement_id');
create trigger jobs_property_org
  before insert or update of org_id, property_id on public.jobs
  for each row execute function private.child_org_guard('properties', 'property_id');
create trigger jobs_quote_org
  before insert or update of org_id, quote_id on public.jobs
  for each row execute function private.child_org_guard('quotes', 'quote_id');

create trigger crew_members_crew_org
  before insert or update of org_id, crew_id on public.crew_members
  for each row execute function private.child_org_guard('crews', 'crew_id');

create trigger routes_crew_org
  before insert or update of org_id, crew_id on public.routes
  for each row execute function private.child_org_guard('crews', 'crew_id');

create trigger visits_agreement_org
  before insert or update of org_id, agreement_id on public.visits
  for each row execute function private.child_org_guard('agreements', 'agreement_id');
create trigger visits_job_org
  before insert or update of org_id, job_id on public.visits
  for each row execute function private.child_org_guard('jobs', 'job_id');
create trigger visits_property_org
  before insert or update of org_id, property_id on public.visits
  for each row execute function private.child_org_guard('properties', 'property_id');
create trigger visits_route_org
  before insert or update of org_id, route_id on public.visits
  for each row execute function private.child_org_guard('routes', 'route_id');

create trigger visit_tasks_visit_org
  before insert or update of org_id, visit_id on public.visit_tasks
  for each row execute function private.child_org_guard('visits', 'visit_id');
create trigger visit_tasks_line_item_org
  before insert or update of org_id, source_line_item_id on public.visit_tasks
  for each row execute function private.child_org_guard('quote_line_items', 'source_line_item_id');

-- The visit's agreement and property are the job's, so the idempotency key
-- on (org, agreement, day) cannot drift from the job the office scheduled.
-- Security definer so the check sees the job even when the caller may not,
-- and the insert policy is what denies a field role.
create or replace function private.visits_match_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property uuid;
  v_agreement uuid;
begin
  select j.property_id, j.agreement_id
    into v_property, v_agreement
  from public.jobs j
  where j.id = new.job_id
    and j.org_id = new.org_id;

  if not found then
    raise exception 'job must belong to the same org' using errcode = '23503';
  end if;
  if v_property is distinct from new.property_id
     or v_agreement is distinct from new.agreement_id then
    raise exception 'visit property and agreement must match the job' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger visits_match_job
  before insert or update of org_id, job_id, property_id, agreement_id on public.visits
  for each row execute function private.visits_match_job();

-- ---------------------------------------------------------------------------
-- Who can write, and which crew a person is actually on.
-- Role checks read memberships (live), not the JWT role by itself.
-- ---------------------------------------------------------------------------
create or replace function private.can_dispatch(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(
    target_org,
    array['owner', 'admin', 'dispatcher']::public.org_role[]
  );
$$;

-- Sales may insert and update the records quote conversion will create.
-- They do not dispatch crews or delete.
create or replace function private.can_write_job_records(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(
    target_org,
    array['owner', 'admin', 'dispatcher', 'sales']::public.org_role[]
  );
$$;

-- Office and read_only. Field roles are not in this list.
create or replace function private.can_read_office_records(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(target_org)
     and not private.has_org_role(
       target_org,
       array['crew', 'crew_lead']::public.org_role[]
     );
$$;

create or replace function private.org_local_today(target_org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (timezone(
    coalesce(
      (select o.timezone from public.orgs o where o.id = target_org),
      'UTC'
    ),
    now()
  ))::date;
$$;

-- True when auth.uid() has an active crew or crew_lead membership AND a
-- crew_members row for this crew. JWT org_role alone is not enough.
create or replace function private.is_crew_member(target_org uuid, target_crew uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_org is not null
     and target_crew is not null
     and target_org = private.current_org_id()
     and exists (
       select 1
       from public.crew_members cm
       join public.memberships m
         on m.org_id = cm.org_id
        and m.user_id = cm.profile_id
       where cm.org_id = target_org
         and cm.crew_id = target_crew
         and cm.profile_id = (select auth.uid())
         and m.status = 'active'
         and m.role in ('crew', 'crew_lead')
     );
$$;

create or replace function private.crew_route_in_window(target_org uuid, target_route uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.routes r
    where r.id = target_route
      and r.org_id = target_org
      and r.status <> 'draft'::public.route_status
      and r.date between private.org_local_today(target_org) - 1
                     and private.org_local_today(target_org) + 1
      and private.is_crew_member(target_org, r.crew_id)
  );
$$;

create or replace function private.crew_can_read_visit(target_org uuid, target_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.visits v
    where v.id = target_visit
      and v.org_id = target_org
      and v.scheduled_date between private.org_local_today(target_org) - 1
                               and private.org_local_today(target_org) + 1
      and private.crew_route_in_window(target_org, v.route_id)
  );
$$;

create or replace function private.crew_can_read_job(target_org uuid, target_job uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.visits v
    where v.org_id = target_org
      and v.job_id = target_job
      and private.crew_can_read_visit(target_org, v.id)
  );
$$;

create or replace function private.crew_can_read_property(target_org uuid, target_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.visits v
    where v.org_id = target_org
      and v.property_id = target_property
      and private.crew_can_read_visit(target_org, v.id)
  );
$$;

-- #10 creates private.can_read_property_access(uuid, uuid). Replace it only
-- then. Creating it here would fail a later rebase: #10's copy sorts first
-- and would put the placeholder back, and current main has no property_access.
do $extend_property_access$
begin
  if to_regprocedure('private.can_read_property_access(uuid,uuid)') is null then
    return;
  end if;

  execute $replace$
    create or replace function private.can_read_property_access(target_org uuid, target_property uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $body$
      select target_property is not null
         and (
           private.can_read_office_records(target_org)
           or private.crew_can_read_property(target_org, target_property)
         );
    $body$
  $replace$;

  -- #10 revokes the default PUBLIC/anon execute grant. RLS evaluates this
  -- helper as the caller, so authenticated needs an explicit grant.
  execute 'revoke all on function private.can_read_property_access(uuid, uuid) from public, anon';
  execute 'grant execute on function private.can_read_property_access(uuid, uuid) to authenticated, service_role';
end
$extend_property_access$;

revoke all on function private.can_dispatch(uuid) from public, anon;
revoke all on function private.can_write_job_records(uuid) from public, anon;
revoke all on function private.can_read_office_records(uuid) from public, anon;
revoke all on function private.org_local_today(uuid) from public, anon;
revoke all on function private.is_crew_member(uuid, uuid) from public, anon;
revoke all on function private.crew_route_in_window(uuid, uuid) from public, anon;
revoke all on function private.crew_can_read_visit(uuid, uuid) from public, anon;
revoke all on function private.crew_can_read_job(uuid, uuid) from public, anon;
revoke all on function private.crew_can_read_property(uuid, uuid) from public, anon;
revoke all on function private.crews_before_write() from public, anon;
revoke all on function private.crew_members_before_write() from public, anon;
revoke all on function private.visits_match_job() from public, anon;

grant execute on function private.can_dispatch(uuid) to authenticated, service_role;
grant execute on function private.can_write_job_records(uuid) to authenticated, service_role;
grant execute on function private.can_read_office_records(uuid) to authenticated, service_role;
grant execute on function private.org_local_today(uuid) to authenticated, service_role;
grant execute on function private.is_crew_member(uuid, uuid) to authenticated, service_role;
grant execute on function private.crew_route_in_window(uuid, uuid) to authenticated, service_role;
grant execute on function private.crew_can_read_visit(uuid, uuid) to authenticated, service_role;
grant execute on function private.crew_can_read_job(uuid, uuid) to authenticated, service_role;
grant execute on function private.crew_can_read_property(uuid, uuid) to authenticated, service_role;
grant execute on function private.crews_before_write() to authenticated, service_role;
grant execute on function private.crew_members_before_write() to authenticated, service_role;
grant execute on function private.visits_match_job() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.agreements enable row level security;
alter table public.agreements force row level security;
alter table public.jobs enable row level security;
alter table public.jobs force row level security;
alter table public.crews enable row level security;
alter table public.crews force row level security;
alter table public.crew_members enable row level security;
alter table public.crew_members force row level security;
alter table public.routes enable row level security;
alter table public.routes force row level security;
alter table public.visits enable row level security;
alter table public.visits force row level security;
alter table public.visit_tasks enable row level security;
alter table public.visit_tasks force row level security;

-- Field roles do not read customer identity. Phone, email, contact name, and
-- billing stay on accounts and contacts; those rows are office-only.
drop policy accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

drop policy contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

-- Access columns that remain on properties (and gate_code / access_notes
-- until #10 moves them) are visible to a field role only on a routed visit.
drop policy properties_select on public.properties;
create policy properties_select on public.properties
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_property(org_id, id)
  );

create policy agreements_select on public.agreements
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));
create policy agreements_insert on public.agreements
  for insert to authenticated
  with check ((select private.can_write_job_records(org_id)));
create policy agreements_update on public.agreements
  for update to authenticated
  using ((select private.can_write_job_records(org_id)))
  with check ((select private.can_write_job_records(org_id)));
create policy agreements_delete on public.agreements
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy jobs_select on public.jobs
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_job(org_id, id)
  );
create policy jobs_insert on public.jobs
  for insert to authenticated
  with check ((select private.can_write_job_records(org_id)));
create policy jobs_update on public.jobs
  for update to authenticated
  using ((select private.can_write_job_records(org_id)))
  with check ((select private.can_write_job_records(org_id)));
create policy jobs_delete on public.jobs
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy crews_select on public.crews
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));
create policy crews_insert on public.crews
  for insert to authenticated
  with check ((select private.can_dispatch(org_id)));
create policy crews_update on public.crews
  for update to authenticated
  using ((select private.can_dispatch(org_id)))
  with check ((select private.can_dispatch(org_id)));
create policy crews_delete on public.crews
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy crew_members_select on public.crew_members
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));
create policy crew_members_insert on public.crew_members
  for insert to authenticated
  with check ((select private.can_dispatch(org_id)));
create policy crew_members_update on public.crew_members
  for update to authenticated
  using ((select private.can_dispatch(org_id)))
  with check ((select private.can_dispatch(org_id)));
create policy crew_members_delete on public.crew_members
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy routes_select on public.routes
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_route_in_window(org_id, id)
  );
create policy routes_insert on public.routes
  for insert to authenticated
  with check ((select private.can_dispatch(org_id)));
create policy routes_update on public.routes
  for update to authenticated
  using ((select private.can_dispatch(org_id)))
  with check ((select private.can_dispatch(org_id)));
create policy routes_delete on public.routes
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy visits_select on public.visits
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, id)
  );
create policy visits_insert on public.visits
  for insert to authenticated
  with check ((select private.can_write_job_records(org_id)));
create policy visits_update on public.visits
  for update to authenticated
  using ((select private.can_write_job_records(org_id)))
  with check ((select private.can_write_job_records(org_id)));
create policy visits_delete on public.visits
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy visit_tasks_select on public.visit_tasks
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );
create policy visit_tasks_insert on public.visit_tasks
  for insert to authenticated
  with check ((select private.can_write_job_records(org_id)));
create policy visit_tasks_update on public.visit_tasks
  for update to authenticated
  using ((select private.can_write_job_records(org_id)))
  with check ((select private.can_write_job_records(org_id)));
create policy visit_tasks_delete on public.visit_tasks
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

revoke all on table
  public.agreements,
  public.jobs,
  public.crews,
  public.crew_members,
  public.routes,
  public.visits,
  public.visit_tasks
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.agreements,
  public.jobs,
  public.crews,
  public.crew_members,
  public.routes,
  public.visits,
  public.visit_tasks
to authenticated;

grant all on table
  public.agreements,
  public.jobs,
  public.crews,
  public.crew_members,
  public.routes,
  public.visits,
  public.visit_tasks
to service_role;

-- ---------------------------------------------------------------------------
-- Scheduling RPCs. Appended to this migration (no second file).
--
-- Writes: owner, admin, dispatcher. convert_accepted_quote also allows sales.
-- crew and crew_lead are authenticated, so they can reach the functions, and
-- each function rejects them with 42501. anon has no EXECUTE.
-- require_after_photo stays true. crew_size stays >= 1. No price or cost
-- column is written. Crews still cannot read customer phone, email, contact
-- name, or billing; these functions do not copy those fields.
--
-- Idempotent generation uses visits_one_open_per_agreement_day (created above).
-- ---------------------------------------------------------------------------
create unique index if not exists visits_one_open_per_agreement_day
  on public.visits (org_id, agreement_id, scheduled_date)
  where agreement_id is not null
    and status <> 'cancelled'::public.visit_status;

-- Accepted line items for a quote.
--
-- quote_accept stores the resolved choice in public.acceptances.selections:
-- a jsonb array of quote_line_items ids from private.resolve_quote_selection.
-- Included lines and the options the customer picked are in that array.
-- Unchosen options are not.
--
-- 20261009180000_acceptance_not_to_exceed.sql (PR #8) keeps that array and
-- adds accepted_not_to_exceed, has_ranges, not_to_exceed_clause, and
-- disclosure_version. accepted_total stays the sum of selected point prices.
-- This function keeps reading selections only. It does not read accepted_total,
-- accepted_not_to_exceed, price, or cost.
create or replace function private.accepted_quote_task_sources(p_quote uuid)
returns table (
  item_id uuid,
  label text,
  quantity_text text,
  hours numeric,
  is_extra boolean,
  sort integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select q.org_id into v_org
  from public.quotes q
  where q.id = p_quote;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.name,
    trim(both from to_char(i.qty, 'FM999999990.##')) || ' ' || i.unit,
    i.hours,
    i.state <> 'included'::public.item_state,
    i.sort
  from public.acceptances a
  join public.quote_versions v
    on v.quote_id = a.quote_id
   and v.version = a.version
  join public.quote_line_items i
    on i.version_id = v.id
   and i.id in (
     select (jsonb_array_elements_text(a.selections))::uuid
   )
  where a.quote_id = p_quote
  order by i.sort, i.id;
end;
$$;

revoke all on function private.accepted_quote_task_sources(uuid) from public, anon;
grant execute on function private.accepted_quote_task_sources(uuid) to authenticated, service_role;

create or replace function public.convert_accepted_quote(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_version_id uuid;
  v_start date;
  v_agreement uuid;
  v_job uuid;
  v_visit uuid;
  v_title text;
  v_crew_size integer := 1;
  v_budget integer;
begin
  select * into q
  from public.quotes
  where id = p_quote_id
  for update;

  if not found or q.org_id is distinct from private.current_org_id() then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(q.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if q.status is distinct from 'accepted' then
    raise exception 'only an accepted quote can be converted' using errcode = '22023';
  end if;
  if q.property_id is null then
    raise exception 'quote needs a property' using errcode = '22023';
  end if;
  if exists (select 1 from public.agreements where quote_id = q.id) then
    raise exception 'quote already converted' using errcode = '23505';
  end if;

  select v.id into v_version_id
  from public.acceptances a
  join public.quote_versions v
    on v.quote_id = a.quote_id
   and v.version = a.version
  where a.quote_id = q.id;

  if v_version_id is null then
    raise exception 'accepted quote has no acceptance' using errcode = 'P0002';
  end if;

  v_start := private.org_local_today(q.org_id);
  v_title := left(btrim(q.title), 200);
  if v_title is null or length(v_title) < 1 then
    v_title := 'Service quote';
  end if;

  -- Hours only. accepted_quote_task_sources does not return price or cost.
  select coalesce(round(sum(s.hours) * 60 / v_crew_size)::integer, 0)
    into v_budget
  from private.accepted_quote_task_sources(q.id) s;

  insert into public.agreements (
    org_id, account_id, property_id, quote_id, quote_version_id,
    kind, start_date, preferred_dow, status
  ) values (
    q.org_id, q.account_id, q.property_id, q.id, v_version_id,
    'one_time', v_start, extract(dow from v_start)::smallint, 'active'
  )
  returning id into v_agreement;

  insert into public.jobs (
    org_id, agreement_id, property_id, quote_id, title, status, require_after_photo
  ) values (
    q.org_id, v_agreement, q.property_id, q.id, v_title, 'scheduled', true
  )
  returning id into v_job;

  insert into public.visits (
    org_id, agreement_id, job_id, property_id,
    sort, scheduled_date, status, crew_size, budget_minutes, require_after_photo
  ) values (
    q.org_id, v_agreement, v_job, q.property_id,
    0, v_start, 'scheduled', v_crew_size, v_budget, true
  )
  returning id into v_visit;

  insert into public.visit_tasks (
    org_id, visit_id, label, quantity_text, source_line_item_id, is_extra, sort
  )
  select
    q.org_id, v_visit, s.label, s.quantity_text, s.item_id, s.is_extra, s.sort
  from private.accepted_quote_task_sources(q.id) s;

  return jsonb_build_object('agreement_id', v_agreement, 'job_id', v_job);
end;
$$;

revoke all on function public.convert_accepted_quote(uuid) from public, anon;
grant execute on function public.convert_accepted_quote(uuid) to authenticated, service_role;

-- Recurring dates through p_through (inclusive), capped by end_date.
-- weekly / custom: every 7 days. biweekly: every 14. monthly: the start
-- date's day-of-month, clamped to the month (31 Jan -> 28 Feb).
-- preferred_dow (Postgres extract(dow), Sunday = 0) shifts weekly, biweekly,
-- and custom forward onto that weekday. custom requires preferred_dow.
-- monthly keeps the calendar day. The office default horizon is 8 weeks;
-- the caller passes that as p_through. Apps mirror this in
-- apps/web/src/lib/scheduling/recurrence.ts.
create or replace function public.generate_agreement_visits(p_agreement_id uuid, p_through date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_until date;
  v_cursor date;
  v_step integer;
  v_n integer;
  v_dates date[] := array[]::date[];
  v_job uuid;
  v_property uuid;
  v_template uuid;
  v_crew_size integer := 1;
  v_budget integer := 0;
  v_new_ids uuid[];
  v_org uuid;
  v_agreement uuid;
  v_quote uuid;
begin
  if p_through is null then
    raise exception 'through date is required' using errcode = '22023';
  end if;

  select * into a
  from public.agreements
  where id = p_agreement_id
  for update;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.kind::text is distinct from 'recurring' or a.frequency is null then
    raise exception 'not a recurring agreement' using errcode = '22023';
  end if;
  if a.frequency::text not in ('weekly', 'biweekly', 'monthly', 'custom') then
    raise exception 'not a recurring agreement' using errcode = '22023';
  end if;
  if a.status::text is distinct from 'active' then
    raise exception 'agreement is not active' using errcode = '22023';
  end if;
  if a.frequency::text = 'custom' and a.preferred_dow is null then
    raise exception 'custom frequency needs a preferred day of week' using errcode = '22023';
  end if;

  v_org := a.org_id;
  v_agreement := a.id;
  v_quote := a.quote_id;

  v_until := p_through;
  if a.end_date is not null and a.end_date < v_until then
    v_until := a.end_date;
  end if;

  if a.frequency::text = 'monthly' then
    v_n := 0;
    loop
      v_cursor := (a.start_date + make_interval(months => v_n))::date;
      exit when v_cursor > v_until;
      if v_cursor >= a.start_date then
        v_dates := v_dates || v_cursor;
      end if;
      v_n := v_n + 1;
      exit when v_n > 600;
    end loop;
  else
    v_step := case when a.frequency::text = 'biweekly' then 14 else 7 end;
    if a.preferred_dow is null then
      v_cursor := a.start_date;
    else
      v_cursor := a.start_date
        + ((a.preferred_dow - extract(dow from a.start_date)::integer + 7) % 7);
    end if;
    while v_cursor <= v_until loop
      v_dates := v_dates || v_cursor;
      v_cursor := v_cursor + v_step;
      exit when cardinality(v_dates) > 600;
    end loop;
  end if;

  if cardinality(v_dates) = 0 then
    return 0;
  end if;

  select j.id, j.property_id
    into v_job, v_property
  from public.jobs j
  where j.agreement_id = a.id
    and j.org_id = a.org_id
  order by j.created_at, j.id
  limit 1;

  if v_job is null then
    raise exception 'agreement has no job' using errcode = '22023';
  end if;

  select v.id, v.crew_size
    into v_template, v_crew_size
  from public.visits v
  where v.agreement_id = a.id
    and v.org_id = a.org_id
    and v.status <> 'cancelled'::public.visit_status
  order by v.scheduled_date, v.created_at, v.id
  limit 1;

  v_crew_size := greatest(coalesce(v_crew_size, 1), 1);

  if v_quote is not null then
    select coalesce(round(sum(s.hours) * 60 / v_crew_size)::integer, 0)
      into v_budget
    from private.accepted_quote_task_sources(v_quote) s;
  elsif v_template is not null then
    select coalesce(v.budget_minutes, 0)
      into v_budget
    from public.visits v
    where v.id = v_template;
  end if;

  with inserted as (
    insert into public.visits (
      org_id, agreement_id, job_id, property_id,
      sort, scheduled_date, status, crew_size, budget_minutes, require_after_photo
    )
    select
      v_org, v_agreement, v_job, v_property,
      0, d, 'scheduled', v_crew_size, v_budget, true
    from unnest(v_dates) as d
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[])
    into v_new_ids
  from inserted;

  if cardinality(v_new_ids) = 0 then
    return 0;
  end if;

  if v_template is not null and exists (
    select 1 from public.visit_tasks t where t.visit_id = v_template
  ) then
    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, source_line_item_id, is_extra, sort
    )
    select
      v_org, n.id, t.label, t.quantity_text, t.source_line_item_id, t.is_extra, t.sort
    from unnest(v_new_ids) as n(id)
    cross join public.visit_tasks t
    where t.visit_id = v_template;
  elsif v_quote is not null then
    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, source_line_item_id, is_extra, sort
    )
    select
      v_org, n.id, s.label, s.quantity_text, s.item_id, s.is_extra, s.sort
    from unnest(v_new_ids) as n(id)
    cross join private.accepted_quote_task_sources(v_quote) s;
  end if;

  update public.jobs
  set status = 'scheduled'
  where id = v_job
    and status = 'unscheduled';

  return cardinality(v_new_ids);
end;
$$;

revoke all on function public.generate_agreement_visits(uuid, date) from public, anon;
grant execute on function public.generate_agreement_visits(uuid, date) to authenticated, service_role;

-- Office assignment wins: the visit moves onto this crew's route for the date
-- even when it was already routed. The route is created as draft when missing
-- and left as-is when the office already published it.
create or replace function public.assign_visit(
  p_visit_id uuid,
  p_crew_id uuid,
  p_service_date date,
  p_sort integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_route uuid;
begin
  if p_service_date is null then
    raise exception 'service date is required' using errcode = '22023';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from private.current_org_id() then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_visit.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.crews c
    where c.id = p_crew_id
      and c.org_id = v_visit.org_id
  ) then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;

  insert into public.routes (org_id, crew_id, date, status)
  values (v_visit.org_id, p_crew_id, p_service_date, 'draft')
  on conflict (org_id, crew_id, date) do nothing
  returning id into v_route;

  if v_route is null then
    select r.id into v_route
    from public.routes r
    where r.org_id = v_visit.org_id
      and r.crew_id = p_crew_id
      and r.date = p_service_date;
  end if;

  update public.visits
  set route_id = v_route,
      scheduled_date = p_service_date,
      sort = coalesce(p_sort, 0)
  where id = v_visit.id;

  update public.jobs
  set status = 'scheduled'
  where id = v_visit.job_id
    and status = 'unscheduled';

  return v_route;
end;
$$;

revoke all on function public.assign_visit(uuid, uuid, date, integer) from public, anon;
grant execute on function public.assign_visit(uuid, uuid, date, integer) to authenticated, service_role;

create or replace function public.reorder_route_visits(p_route_id uuid, p_visit_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_matched integer;
begin
  select r.org_id into v_org
  from public.routes r
  where r.id = p_route_id
  for update;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'route not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_visit_ids is null or cardinality(p_visit_ids) = 0 then
    raise exception 'visit list is empty' using errcode = '22023';
  end if;
  if (
    select count(distinct picked)
    from unnest(p_visit_ids) as picked
  ) <> cardinality(p_visit_ids) then
    raise exception 'duplicate visit' using errcode = '22023';
  end if;

  select count(*) into v_matched
  from public.visits v
  where v.route_id = p_route_id
    and v.org_id = v_org
    and v.id = any(p_visit_ids);

  if v_matched <> cardinality(p_visit_ids) then
    raise exception 'visit is not on this route' using errcode = '22023';
  end if;

  update public.visits v
  set sort = u.ord::integer - 1
  from unnest(p_visit_ids) with ordinality as u(id, ord)
  where v.id = u.id
    and v.route_id = p_route_id
    and v.org_id = v_org;
end;
$$;

revoke all on function public.reorder_route_visits(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_route_visits(uuid, uuid[]) to authenticated, service_role;

create or replace function public.publish_route(p_route_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route public.routes;
  v_at timestamptz;
begin
  select * into v_route
  from public.routes
  where id = p_route_id
  for update;

  if not found or v_route.org_id is distinct from private.current_org_id() then
    raise exception 'route not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_route.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_route.status = 'published' and v_route.published_at is not null then
    return v_route.published_at;
  end if;
  if v_route.status in ('in_progress', 'done') then
    raise exception 'route cannot be published' using errcode = '22023';
  end if;

  v_at := now();
  update public.routes
  set status = 'published',
      published_at = v_at
  where id = v_route.id;

  return v_at;
end;
$$;

revoke all on function public.publish_route(uuid) from public, anon;
grant execute on function public.publish_route(uuid) to authenticated, service_role;

create or replace function public.create_crew(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_id uuid;
begin
  v_org := private.current_org_id();
  if v_org is null or not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'crew name is required' using errcode = '22023';
  end if;

  insert into public.crews (org_id, name)
  values (v_org, v_name)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_crew(text) from public, anon;
grant execute on function public.create_crew(text) to authenticated, service_role;

create or replace function public.add_crew_member(p_crew_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select c.org_id into v_org
  from public.crews c
  where c.id = p_crew_id
  for update;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.crew_members (org_id, crew_id, profile_id)
  values (v_org, p_crew_id, p_profile_id);
end;
$$;

revoke all on function public.add_crew_member(uuid, uuid) from public, anon;
grant execute on function public.add_crew_member(uuid, uuid) to authenticated, service_role;
