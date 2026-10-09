-- Jobs and scheduling (build steps 9–10), schema and access only.
--
-- Office converts an accepted quote into an agreement and visits in a later
-- revision of this file. This revision is the tables, the crew-scoped read
-- helpers, and RLS. It does not create convert/generate/assign/publish RPCs,
-- and it does not create time_entries, visit_photos, enhancement_requests,
-- visit_events, crew_day_pack, or crew_sync.
--
-- Money stays on quotes. These tables store budget_minutes only.
-- An after photo is required on every job and visit (no opt-out).
--
-- Depends on PR #10 (20261009105000_privilege_gaps.sql), which is still open.
-- That migration moves properties.gate_code and properties.access_notes onto
-- public.property_access and creates
-- private.can_read_property_access(target_org uuid, target_property uuid).
-- Its placeholder is `target_property is not null and can_read_pricing(org)`.
-- can_read_pricing includes owner, admin, sales, dispatcher, crew_lead, and
-- read_only, and excludes crew. This file does not create property_access and
-- does not move those columns. It replaces the helper only when #10 has
-- already created it, so a database built from current main is unchanged and
-- a rebase onto #10 applies the extension:
--   * owner, admin, sales, dispatcher, and read_only still read every property
--   * crew and crew_lead read property_access only for a property on a
--     non-draft visit routed to a crew they belong to, scheduled within the
--     org's today ± 1 day
-- Quote price policies from #10 are left alone. On main, before #10, gate
-- codes still live on properties and properties_select limits field roles to
-- those same assigned visits.

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

-- Deferred on this same migration file: convert an accepted quote, generate
-- visits (idempotent via the partial unique indexes above), assign, reorder,
-- publish, and create-crew RPCs. Anon EXECUTE tests belong with those
-- functions. Do not add them in the schema revision.
