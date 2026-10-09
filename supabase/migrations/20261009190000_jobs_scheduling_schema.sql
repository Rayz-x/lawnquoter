-- Jobs and scheduling schema (build steps 9–10).
--
-- Tables, crew-scoped reads, RLS, helpers, and triggers.
-- Scheduling RPCs are in 20261009190100_jobs_scheduling_rpcs.sql.
-- This file does not create time_entries, visit_photos, enhancement_requests,
-- visit_events, crew_day_pack, or crew_sync.
--
-- Money stays on quotes. These tables store budget_minutes only.
-- Dusty's rule: every visit requires an after photo. visit_photos does not
-- exist yet, so this file refuses status completed. Step 11 adds a BEFORE
-- UPDATE trigger that requires an after-photo row once that table exists.
--
-- Depends on 20261009130000_privilege_gaps.sql (PR #10). That migration moves
-- properties.gate_code and properties.access_notes onto public.property_access
-- and creates private.can_read_property_access(uuid, uuid). can_read_pricing
-- allows owner, admin, sales, dispatcher, and read_only, and excludes crew
-- and crew_lead. This file does not create property_access and does not move
-- those columns. It replaces the helper now that the function exists:
--   * owner, admin, sales, dispatcher, and read_only still read every property
--   * crew and crew_lead read property_access only for a property on a
--     non-draft, non-cancelled visit routed to a crew they belong to,
--     scheduled within the org's today ± 1 day
-- Quote price policies from #10 are left alone. can_read_pricing is not changed.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.agreement_kind as enum ('one_time', 'recurring');
create type public.agreement_frequency as enum ('weekly', 'biweekly', 'monthly');
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

create index agreements_account_id_idx on public.agreements (account_id);
create index agreements_property_id_idx on public.agreements (property_id);
create unique index agreements_quote_id_key on public.agreements (quote_id)
  where quote_id is not null;
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
  agreement_id uuid references public.agreements(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  status public.job_status not null default 'unscheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  unique (crew_id, profile_id),
  unique (org_id, profile_id)
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
  revision integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, crew_id, date)
);

create index routes_crew_id_idx on public.routes (crew_id);
create index routes_org_date_idx on public.routes (org_id, date);

create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function private.set_updated_at();

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agreement_id uuid references public.agreements(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  route_id uuid references public.routes(id) on delete set null,
  sort integer not null default 0,
  occurrence_date date not null,
  scheduled_date date,
  window_start time,
  window_end time,
  status public.visit_status not null default 'scheduled',
  started_at timestamptz,
  completed_at timestamptz,
  crew_size integer not null default 1,
  budget_minutes integer,
  skip_reason public.visit_skip_reason,
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
  )
);

create index visits_agreement_id_idx on public.visits (agreement_id);
create index visits_job_id_idx on public.visits (job_id);
create index visits_property_id_idx on public.visits (property_id);
create index visits_route_sort_idx on public.visits (route_id, sort);
create index visits_org_scheduled_idx on public.visits (org_id, scheduled_date);

-- One row per agreement occurrence, including cancelled and moved visits.
-- assign_visit changes scheduled_date and leaves occurrence_date alone, so a
-- later generate cannot recreate that occurrence.
create unique index visits_agreement_occurrence_key
  on public.visits (org_id, agreement_id, occurrence_date)
  where agreement_id is not null;

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
  notes_crew text,
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

-- Office-only visit note. Crew has no select policy on this table, so the
-- note is not readable from the visits row.
create table public.visit_office_notes (
  visit_id uuid primary key references public.visits(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index visit_office_notes_org_id_idx on public.visit_office_notes (org_id);

create trigger visit_office_notes_set_updated_at
  before update on public.visit_office_notes
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

-- Field membership only. Owner, admin, sales, dispatcher, and read_only are
-- not crew members. Step 11 start/finish RPCs require the caller to be the
-- lead of that crew (default_lead_id), not merely a field member.
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
      and m.role in ('crew', 'crew_lead')
  ) then
    raise exception 'profile must be an active crew or crew lead' using errcode = '23503';
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
  if new.default_lead_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = new.org_id
      and m.user_id = new.default_lead_id
      and m.status = 'active'
      and m.role = 'crew_lead'
  ) then
    raise exception 'default lead must be an active crew lead' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.crew_members cm
    where cm.org_id = new.org_id
      and cm.crew_id = new.id
      and cm.profile_id = new.default_lead_id
  ) then
    raise exception 'default lead must be a member of this crew' using errcode = '23514';
  end if;
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

-- Removing or moving the member who is crews.default_lead_id is rejected.
-- Change the lead with set_crew_lead first, which writes default_lead_id,
-- and only then remove the previous member. Step 11 start/finish must check
-- the live lead on crews.default_lead_id, not a membership cached earlier.
create or replace function private.crew_members_protect_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  select c.default_lead_id into v_lead
  from public.crews c
  where c.id = old.crew_id;

  if v_lead is null or v_lead is distinct from old.profile_id then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE'
     or new.profile_id is distinct from old.profile_id
     or new.crew_id is distinct from old.crew_id then
    raise exception 'the default lead cannot be removed from the crew' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger crew_members_protect_lead
  before update or delete on public.crew_members
  for each row execute function private.crew_members_protect_lead();

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

create trigger visit_office_notes_visit_org
  before insert or update of org_id, visit_id on public.visit_office_notes
  for each row execute function private.child_org_guard('visits', 'visit_id');

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
      and v.status <> 'cancelled'::public.visit_status
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
      and v.status <> 'cancelled'::public.visit_status
      and private.crew_can_read_visit(target_org, v.id)
  );
$$;

-- #10 creates private.can_read_property_access(uuid, uuid). Replace it.
-- Office roles still read every property. Field roles read only an assigned,
-- non-cancelled, in-window visit. can_read_pricing is not changed.
create or replace function private.can_read_property_access(target_org uuid, target_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_property is not null
     and (
       private.can_read_office_records(target_org)
       or private.crew_can_read_property(target_org, target_property)
     );
$$;

revoke all on function private.can_read_property_access(uuid, uuid) from public, anon;
grant execute on function private.can_read_property_access(uuid, uuid) to authenticated, service_role;

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
revoke all on function private.crew_members_protect_lead() from public, anon;
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
grant execute on function private.crew_members_protect_lead() to authenticated, service_role;
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
create policy agreements_update on public.agreements
  for update to authenticated
  using ((select private.can_dispatch(org_id)))
  with check ((select private.can_dispatch(org_id)));
create policy agreements_delete on public.agreements
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy jobs_select on public.jobs
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_job(org_id, id)
  );
create policy jobs_update on public.jobs
  for update to authenticated
  using ((select private.can_dispatch(org_id)))
  with check ((select private.can_dispatch(org_id)));
create policy jobs_delete on public.jobs
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy crews_select on public.crews
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.is_crew_member(org_id, id)
  );
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
  using (
    (select private.can_read_office_records(org_id))
    or private.is_crew_member(org_id, crew_id)
  );
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
create policy routes_delete on public.routes
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy visits_select on public.visits
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, id)
  );
create policy visits_update on public.visits
  for update to authenticated
  using ((select private.can_dispatch(org_id)))
  with check ((select private.can_dispatch(org_id)));
create policy visits_delete on public.visits
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

create policy visit_tasks_select on public.visit_tasks
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );
create policy visit_tasks_delete on public.visit_tasks
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

alter table public.visit_office_notes enable row level security;
alter table public.visit_office_notes force row level security;

create policy visit_office_notes_select on public.visit_office_notes
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));
create policy visit_office_notes_insert on public.visit_office_notes
  for insert to authenticated
  with check ((select private.can_dispatch(org_id)));
create policy visit_office_notes_update on public.visit_office_notes
  for update to authenticated
  using ((select private.can_dispatch(org_id)))
  with check ((select private.can_dispatch(org_id)));
create policy visit_office_notes_delete on public.visit_office_notes
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

revoke all on table
  public.agreements,
  public.jobs,
  public.crews,
  public.crew_members,
  public.routes,
  public.visits,
  public.visit_tasks,
  public.visit_office_notes
from public, anon, authenticated;

grant select, delete on table public.agreements to authenticated;
grant update (notes_office) on table public.agreements to authenticated;
grant select, delete on table public.jobs to authenticated;
grant update (title) on table public.jobs to authenticated;
grant select, insert, delete on table public.crews to authenticated;
grant update (name, active) on table public.crews to authenticated;
grant select, insert, update, delete on table public.crew_members to authenticated;
grant select, delete on table public.routes to authenticated;
grant select, delete on table public.visits to authenticated;
grant update (window_start, window_end) on table public.visits to authenticated;
grant select, delete on table public.visit_tasks to authenticated;
grant select, insert, update, delete on table public.visit_office_notes to authenticated;

grant all on table
  public.agreements,
  public.jobs,
  public.crews,
  public.crew_members,
  public.routes,
  public.visits,
  public.visit_tasks,
  public.visit_office_notes
to service_role;

-- ---------------------------------------------------------------------------
-- Triggers. The scheduling RPCs are in 20261009190100_jobs_scheduling_rpcs.sql.
--
-- Authenticated UPDATE on visits is window_start and window_end, and only
-- for dispatch roles. Sales cannot set route_id or scheduled_date.
-- occurrence_date is the generation key. assign_visit, in the RPC migration,
-- changes scheduled_date and does not change occurrence_date.
--
-- Dusty's rule: every visit requires an after photo. visit_photos is step 11.
-- Until that table exists, status completed is rejected. Step 11 replaces
-- private.reject_completed_status with a BEFORE UPDATE trigger that requires
-- an after-photo row.
-- Step 11 start/finish RPCs must require the caller to be that crew's live
-- lead (crews.default_lead_id), not merely a member and not a lead id copied
-- onto the visit earlier. crew_members_protect_lead rejects removing that
-- person until set_crew_lead points default_lead_id somewhere else.
-- ---------------------------------------------------------------------------

create or replace function private.reject_completed_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status::text = 'completed' then
    raise exception 'completing a visit requires an after photo' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger jobs_reject_completed
  before insert or update of status on public.jobs
  for each row execute function private.reject_completed_status();

create trigger visits_reject_completed
  before insert or update of status on public.visits
  for each row execute function private.reject_completed_status();

-- A visit that belongs to an agreement is an occurrence. Deleting it directly
-- lets the next generate recreate that date. Cancel or skip instead, which
-- keeps the row. Deleting the job or the agreement cascades, and that nested
-- delete is allowed: pg_trigger_depth() is 1 for a direct delete and higher
-- while a foreign-key cascade is already running.
create or replace function private.visits_reject_agreement_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.agreement_id is not null then
    raise exception 'visits on an agreement are cancelled, not deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger visits_reject_agreement_delete
  before delete on public.visits
  for each row execute function private.visits_reject_agreement_delete();

-- A dispatcher may delete an agreement or a job, and that cascades to visits.
-- Completed, in-progress, paused, skipped, and cant_complete visits must stay.
-- Only scheduled and cancelled visits may disappear with the parent. Deleting
-- the org still cascades: that nested delete is already inside another trigger.
create or replace function private.reject_parent_delete_with_live_visits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_table_name = 'agreements' and exists (
    select 1
    from public.visits v
    where v.agreement_id = old.id
      and v.status not in (
        'scheduled'::public.visit_status,
        'cancelled'::public.visit_status
      )
  ) then
    raise exception 'an agreement with a visit that is not scheduled or cancelled cannot be deleted'
      using errcode = '22023';
  end if;

  if tg_table_name = 'jobs' and exists (
    select 1
    from public.visits v
    where v.job_id = old.id
      and v.status not in (
        'scheduled'::public.visit_status,
        'cancelled'::public.visit_status
      )
  ) then
    raise exception 'a job with a visit that is not scheduled or cancelled cannot be deleted'
      using errcode = '22023';
  end if;

  return old;
end;
$$;

create trigger agreements_reject_live_visit_delete
  before delete on public.agreements
  for each row execute function private.reject_parent_delete_with_live_visits();

create trigger jobs_reject_live_visit_delete
  before delete on public.jobs
  for each row execute function private.reject_parent_delete_with_live_visits();

-- Status, sort, route, and date changes on a published route bump revision.
-- The later PWA treats that bump as the signal that a stop disappeared: crew
-- select hides cancelled visits, so the crew can no longer open that stop.
create or replace function private.bump_published_route_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route uuid;
begin
  if tg_op = 'DELETE' then
    v_route := old.route_id;
  elsif tg_op = 'UPDATE' then
    if old.route_id is not distinct from new.route_id
       and old.sort is not distinct from new.sort
       and old.scheduled_date is not distinct from new.scheduled_date
       and old.status is not distinct from new.status
       and old.occurrence_date is not distinct from new.occurrence_date then
      return null;
    end if;
    if old.route_id is not null and old.route_id is distinct from new.route_id then
      update public.routes r
      set revision = r.revision + 1
      where r.id = old.route_id
        and r.status <> 'draft'::public.route_status;
    end if;
    v_route := new.route_id;
  else
    v_route := new.route_id;
  end if;

  if v_route is not null then
    update public.routes r
    set revision = r.revision + 1
    where r.id = v_route
      and r.status <> 'draft'::public.route_status;
  end if;
  return null;
end;
$$;

create trigger visits_bump_route_revision
  after insert or update or delete on public.visits
  for each row execute function private.bump_published_route_revision();

create or replace function private.orgs_reject_invalid_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names n where n.name = new.timezone
     ) then
    raise exception 'invalid timezone %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger orgs_reject_invalid_timezone
  before insert or update of timezone on public.orgs
  for each row execute function private.orgs_reject_invalid_timezone();

do $validate_timezones$
declare
  v_bad text;
begin
  select o.timezone into v_bad
  from public.orgs o
  where o.timezone is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names n
       where n.name = o.timezone
     )
  limit 1;
  if found then
    raise exception 'stored timezone % is not in pg_timezone_names', coalesce(v_bad, '(null)')
      using errcode = '22023';
  end if;
end;
$validate_timezones$;

revoke all on function private.reject_completed_status() from public, anon;
revoke all on function private.visits_reject_agreement_delete() from public, anon;
revoke all on function private.reject_parent_delete_with_live_visits() from public, anon;
revoke all on function private.bump_published_route_revision() from public, anon;
revoke all on function private.orgs_reject_invalid_timezone() from public, anon;
grant execute on function private.reject_completed_status() to authenticated, service_role;
grant execute on function private.visits_reject_agreement_delete() to authenticated, service_role;
grant execute on function private.reject_parent_delete_with_live_visits() to authenticated, service_role;
grant execute on function private.bump_published_route_revision() to authenticated, service_role;
grant execute on function private.orgs_reject_invalid_timezone() to authenticated, service_role;

