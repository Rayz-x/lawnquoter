-- Jobs and scheduling (build steps 9–10).
--
-- Tables, crew-scoped reads, RLS, and the office RPCs that convert an
-- accepted quote, generate visits, assign, reorder, publish, and create crews.
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
  agreement_id uuid references public.agreements(id) on delete restrict,
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
  agreement_id uuid references public.agreements(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
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
create policy jobs_insert on public.jobs
  for insert to authenticated
  with check ((select private.can_write_job_records(org_id)));
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

grant select, insert, delete on table public.agreements to authenticated;
grant update (notes_office) on table public.agreements to authenticated;
grant select, insert, delete on table public.jobs to authenticated;
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
-- Scheduling RPCs. Appended to this migration (no second file).
--
-- Writes: owner, admin, dispatcher. convert_accepted_quote also allows sales.
-- crew and crew_lead are authenticated, so they can reach the functions, and
-- each function rejects them with 42501. anon has no EXECUTE.
-- crew_size stays >= 1. No price or cost column is written. Crews still
-- cannot read customer phone, email, contact name, or billing.
--
-- Status, route, and scheduled_date change only through these RPCs.
-- Authenticated UPDATE on visits is window_start and window_end, and only
-- for dispatch roles. Sales cannot set route_id or scheduled_date.
-- occurrence_date is the generation key and assign_visit does not change it.
--
-- Dusty's rule: every visit requires an after photo. visit_photos is step 11.
-- Until that table exists, status completed is rejected. Step 11 replaces
-- private.reject_completed_status with a BEFORE UPDATE trigger that requires
-- an after-photo row.
-- Step 11 start/finish RPCs must require the caller to be that crew's lead
-- (crews.default_lead_id), not merely a member.
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

revoke all on function private.reject_completed_status() from public, anon;
revoke all on function private.bump_published_route_revision() from public, anon;
revoke all on function private.orgs_reject_invalid_timezone() from public, anon;
grant execute on function private.reject_completed_status() to authenticated, service_role;
grant execute on function private.bump_published_route_revision() to authenticated, service_role;
grant execute on function private.orgs_reject_invalid_timezone() to authenticated, service_role;

-- Accepted line items for a quote.
--
-- quote_accept stores the resolved choice in public.acceptances.selections:
-- a jsonb array of quote_line_items ids from private.resolve_quote_selection.
-- Included lines and the options the customer picked are in that array.
-- Unchosen options are not.
--
-- 20261009180000 keeps that array. accepted_total stays the sum of selected
-- point prices. This function reads selections only. It does not read
-- accepted_total, accepted_not_to_exceed, price, or cost.
--
-- is_extra means a one-time add-on, not a chosen option. Quote lines copied
-- here are ordinary tasks (is_extra false), including a chosen option.
-- notes_crew is the crew instruction from the line, not a customer contact.
create or replace function private.accepted_quote_task_sources(p_quote uuid)
returns table (
  item_id uuid,
  label text,
  quantity_text text,
  notes_crew text,
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
    coalesce(
      trim_scale(i.qty)::text || coalesce(' ' || nullif(btrim(i.unit), ''), ''),
      ''
    ),
    i.notes_crew,
    i.hours,
    false,
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

create or replace function public.convert_accepted_quote(
  p_quote_id uuid,
  p_kind text default 'one_time',
  p_frequency text default null,
  p_preferred_dow integer default null,
  p_start_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_version_id uuid;
  v_agreement uuid;
  v_job uuid;
  v_visit uuid;
  v_title text;
  v_crew_size integer := 1;
  v_budget integer;
  v_kind public.agreement_kind;
  v_frequency public.agreement_frequency;
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

  select a.id into v_agreement
  from public.agreements a
  where a.quote_id = q.id
    and a.org_id = q.org_id;
  if v_agreement is not null then
    select j.id into v_job
    from public.jobs j
    where j.agreement_id = v_agreement
      and j.org_id = q.org_id
    order by j.created_at, j.id
    limit 1;
    return jsonb_build_object('agreement_id', v_agreement, 'job_id', v_job);
  end if;

  if p_kind is null or p_kind not in ('one_time', 'recurring') then
    raise exception 'kind must be one_time or recurring' using errcode = '22023';
  end if;
  if p_start_date is null then
    p_start_date := private.org_local_today(q.org_id);
  end if;
  if p_preferred_dow is not null and p_preferred_dow not between 0 and 6 then
    raise exception 'preferred day of week must be 0 through 6' using errcode = '22023';
  end if;
  if p_kind = 'one_time' then
    if p_frequency is not null then
      raise exception 'one-time agreements have no frequency' using errcode = '22023';
    end if;
    v_frequency := null;
  else
    if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'recurring agreements need a weekly, biweekly, or monthly frequency' using errcode = '22023';
    end if;
    v_frequency := p_frequency::public.agreement_frequency;
  end if;
  v_kind := p_kind::public.agreement_kind;

  select v.id into v_version_id
  from public.acceptances a
  join public.quote_versions v
    on v.quote_id = a.quote_id
   and v.version = a.version
  where a.quote_id = q.id;

  if v_version_id is null then
    raise exception 'accepted quote has no acceptance' using errcode = 'P0002';
  end if;

  v_title := left(btrim(q.title), 200);
  if v_title is null or length(v_title) < 1 then
    v_title := 'Service quote';
  end if;

  select coalesce(round(sum(s.hours) * 60 / v_crew_size)::integer, 0)
    into v_budget
  from private.accepted_quote_task_sources(q.id) s;

  insert into public.agreements (
    org_id, account_id, property_id, quote_id, quote_version_id,
    kind, frequency, start_date, preferred_dow, status
  ) values (
    q.org_id, q.account_id, q.property_id, q.id, v_version_id,
    v_kind, v_frequency, p_start_date, p_preferred_dow, 'active'
  )
  returning id into v_agreement;

  insert into public.jobs (
    org_id, agreement_id, property_id, quote_id, title, status
  ) values (
    q.org_id, v_agreement, q.property_id, q.id, v_title, 'unscheduled'
  )
  returning id into v_job;

  insert into public.visits (
    org_id, agreement_id, job_id, property_id,
    sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
  ) values (
    q.org_id, v_agreement, v_job, q.property_id,
    0, p_start_date, null, 'scheduled', v_crew_size, v_budget
  )
  returning id into v_visit;

  insert into public.visit_tasks (
    org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, is_extra, sort
  )
  select
    q.org_id, v_visit, s.label, s.quantity_text, s.notes_crew, s.item_id, false, s.sort
  from private.accepted_quote_task_sources(q.id) s
  where not s.is_extra;

  return jsonb_build_object('agreement_id', v_agreement, 'job_id', v_job);
exception
  when unique_violation then
    select a.id into v_agreement
    from public.agreements a
    where a.quote_id = p_quote_id;
    if v_agreement is null then
      raise;
    end if;
    select j.id into v_job
    from public.jobs j
    where j.agreement_id = v_agreement
    order by j.created_at, j.id
    limit 1;
    return jsonb_build_object('agreement_id', v_agreement, 'job_id', v_job);
end;
$$;

revoke all on function public.convert_accepted_quote(uuid, text, text, integer, date) from public, anon;
grant execute on function public.convert_accepted_quote(uuid, text, text, integer, date) to authenticated, service_role;

-- Recurring dates from greatest(start_date, org today) through p_through,
-- capped about one year past today and by end_date.
-- weekly: every 7 days. biweekly: every 14. monthly: the start date's
-- day-of-month, clamped to the month (31 Jan -> 28 Feb).
-- preferred_dow (Sunday = 0) shifts weekly and biweekly onto that weekday.
-- monthly keeps the calendar day. The loop stores at most 600 dates.
create or replace function public.generate_agreement_visits(p_agreement_id uuid, p_through date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_today date;
  v_from date;
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
  if a.frequency::text not in ('weekly', 'biweekly', 'monthly') then
    raise exception 'not a recurring agreement' using errcode = '22023';
  end if;
  if a.status::text is distinct from 'active' then
    raise exception 'agreement is not active' using errcode = '22023';
  end if;

  v_org := a.org_id;
  v_agreement := a.id;
  v_quote := a.quote_id;
  v_today := private.org_local_today(a.org_id);
  v_from := greatest(a.start_date, v_today);
  v_until := least(p_through, v_today + 366);
  if a.end_date is not null and a.end_date < v_until then
    v_until := a.end_date;
  end if;

  if a.frequency::text = 'monthly' then
    v_n := 0;
    loop
      exit when cardinality(v_dates) >= 600;
      v_cursor := (a.start_date + make_interval(months => v_n))::date;
      exit when v_cursor > v_until;
      if v_cursor >= v_from then
        v_dates := v_dates || v_cursor;
      end if;
      v_n := v_n + 1;
      exit when v_n >= 600;
    end loop;
  else
    v_step := case when a.frequency::text = 'biweekly' then 14 else 7 end;
    if a.preferred_dow is null then
      v_cursor := a.start_date;
    else
      v_cursor := a.start_date
        + ((a.preferred_dow - extract(dow from a.start_date)::integer + 7) % 7);
    end if;
    if v_cursor < v_from then
      v_cursor := v_cursor + (((v_from - v_cursor) / v_step) * v_step);
    end if;
    while v_cursor < v_from loop
      v_cursor := v_cursor + v_step;
    end loop;
    while v_cursor <= v_until loop
      exit when cardinality(v_dates) >= 600;
      v_dates := v_dates || v_cursor;
      v_cursor := v_cursor + v_step;
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
  order by v.occurrence_date, v.created_at, v.id
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
      sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
    )
    select
      v_org, v_agreement, v_job, v_property,
      0, d, d, 'scheduled', v_crew_size, v_budget
    from unnest(v_dates) as d
    on conflict (org_id, agreement_id, occurrence_date) where agreement_id is not null
    do nothing
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[])
    into v_new_ids
  from inserted;

  if cardinality(v_new_ids) = 0 then
    return 0;
  end if;

  if v_template is not null and exists (
    select 1 from public.visit_tasks t where t.visit_id = v_template and not t.is_extra
  ) then
    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, is_extra, sort
    )
    select
      v_org, n.id, t.label, t.quantity_text, t.notes_crew, t.source_line_item_id, false, t.sort
    from unnest(v_new_ids) as n(id)
    cross join public.visit_tasks t
    where t.visit_id = v_template
      and not t.is_extra;
  elsif v_quote is not null then
    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, is_extra, sort
    )
    select
      v_org, n.id, s.label, s.quantity_text, s.notes_crew, s.item_id, false, s.sort
    from unnest(v_new_ids) as n(id)
    cross join private.accepted_quote_task_sources(v_quote) s
    where not s.is_extra;
  end if;

  return cardinality(v_new_ids);
end;
$$;

revoke all on function public.generate_agreement_visits(uuid, date) from public, anon;
grant execute on function public.generate_agreement_visits(uuid, date) to authenticated, service_role;

-- Assign a scheduled visit. scheduled_date changes and occurrence_date does not.
-- p_sort is accepted and ignored: the route is locked and sort becomes max(sort)+1.
-- in_progress and done routes are refused. Completed and cancelled visits
-- are not scheduled, so they cannot be moved.
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
  v_status public.route_status;
  v_sort integer;
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
  if v_visit.status is distinct from 'scheduled'::public.visit_status then
    raise exception 'only a scheduled visit can be assigned' using errcode = '22023';
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
    select r.id, r.status into v_route, v_status
    from public.routes r
    where r.org_id = v_visit.org_id
      and r.crew_id = p_crew_id
      and r.date = p_service_date
    for update;
  else
    select r.status into v_status
    from public.routes r
    where r.id = v_route
    for update;
  end if;

  if v_status in ('in_progress', 'done') then
    raise exception 'route cannot be changed' using errcode = '22023';
  end if;

  select coalesce(max(v.sort), -1) + 1 into v_sort
  from public.visits v
  where v.route_id = v_route
    and v.id <> v_visit.id;

  update public.visits
  set route_id = v_route,
      scheduled_date = p_service_date,
      sort = v_sort
  where id = v_visit.id;

  update public.jobs
  set status = 'scheduled'
  where id = v_visit.job_id
    and status = 'unscheduled'::public.job_status;

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
  v_status public.route_status;
  v_total integer;
  v_open integer;
begin
  select r.org_id, r.status into v_org, v_status
  from public.routes r
  where r.id = p_route_id
  for update;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'route not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_status in ('in_progress', 'done') then
    raise exception 'route cannot be changed' using errcode = '22023';
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

  select count(*) into v_total
  from public.visits v
  where v.route_id = p_route_id
    and v.org_id = v_org;

  select count(*) into v_open
  from public.visits v
  where v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status
    and v.id = any(p_visit_ids);

  if v_total <> cardinality(p_visit_ids) or v_open <> v_total then
    raise exception 'reorder requires every scheduled visit on the route' using errcode = '22023';
  end if;

  update public.visits v
  set sort = u.ord::integer - 1
  from unnest(p_visit_ids) with ordinality as u(id, ord)
  where v.id = u.id
    and v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status;
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

-- The lead is a crew_lead who already belongs to this crew, or who is added
-- here. A person can belong to one crew in the org.
create or replace function public.set_crew_lead(p_crew_id uuid, p_profile_id uuid)
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
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = v_org
      and m.user_id = p_profile_id
      and m.status = 'active'
      and m.role = 'crew_lead'
  ) then
    raise exception 'lead must be an active crew lead' using errcode = '23514';
  end if;

  insert into public.crew_members (org_id, crew_id, profile_id)
  values (v_org, p_crew_id, p_profile_id)
  on conflict (org_id, profile_id) do nothing;

  if not exists (
    select 1
    from public.crew_members cm
    where cm.crew_id = p_crew_id
      and cm.profile_id = p_profile_id
  ) then
    raise exception 'that person is already on another crew' using errcode = '23505';
  end if;

  update public.crews
  set default_lead_id = p_profile_id
  where id = p_crew_id;
end;
$$;

revoke all on function public.set_crew_lead(uuid, uuid) from public, anon;
grant execute on function public.set_crew_lead(uuid, uuid) to authenticated, service_role;

-- Crews and members for the caller. No prices, phone, email, or customer fields.
create or replace function public.my_crews()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.current_org_id();
  if v_org is null or (select auth.uid()) is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'active', c.active,
        'default_lead_id', c.default_lead_id,
        'members', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'profile_id', cm.profile_id,
              'full_name', p.full_name
            )
            order by p.full_name, cm.profile_id
          ), '[]'::jsonb)
          from public.crew_members cm
          join public.profiles p on p.id = cm.profile_id
          where cm.crew_id = c.id
            and cm.org_id = c.org_id
        )
      )
      order by c.name, c.id
    )
    from public.crews c
    where c.org_id = v_org
      and exists (
        select 1
        from public.crew_members mine
        where mine.crew_id = c.id
          and mine.org_id = c.org_id
          and mine.profile_id = (select auth.uid())
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_crews() from public, anon;
grant execute on function public.my_crews() to authenticated, service_role;

-- Kind, frequency, preferred day, and start date. Owner, admin, dispatcher,
-- and sales. Other agreement columns stay on their own grants.
create or replace function public.update_agreement_schedule(
  p_agreement_id uuid,
  p_kind text,
  p_frequency text default null,
  p_preferred_dow integer default null,
  p_start_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_kind public.agreement_kind;
  v_frequency public.agreement_frequency;
begin
  select * into a
  from public.agreements
  where id = p_agreement_id
  for update;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status = 'ended'::public.agreement_status then
    raise exception 'ended agreements cannot be changed' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception 'start date is required' using errcode = '22023';
  end if;
  if a.end_date is not null and a.end_date < p_start_date then
    raise exception 'start date is after the agreement ends' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('one_time', 'recurring') then
    raise exception 'kind must be one_time or recurring' using errcode = '22023';
  end if;

  if p_kind = 'one_time' then
    v_frequency := null;
    p_preferred_dow := null;
  else
    if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'recurring agreements need a weekly, biweekly, or monthly frequency' using errcode = '22023';
    end if;
    if p_preferred_dow is null or p_preferred_dow not between 0 and 6 then
      raise exception 'preferred day of week must be 0 through 6' using errcode = '22023';
    end if;
    v_frequency := p_frequency::public.agreement_frequency;
  end if;
  v_kind := p_kind::public.agreement_kind;

  update public.agreements
  set kind = v_kind,
      frequency = v_frequency,
      preferred_dow = p_preferred_dow,
      start_date = p_start_date
  where id = a.id;
end;
$$;

revoke all on function public.update_agreement_schedule(uuid, text, text, integer, date) from public, anon;
grant execute on function public.update_agreement_schedule(uuid, text, text, integer, date) to authenticated, service_role;
