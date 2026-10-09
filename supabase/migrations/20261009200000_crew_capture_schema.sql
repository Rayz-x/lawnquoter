-- Crew capture schema (build step 11, part A).
--
-- Tables the crew phone writes: time entries, visit photos, enhancement
-- requests, and an append-only visit event log. Scheduling RPCs stay in
-- 20261009190100. crew_day_pack and crew_sync are not in this file.
--
-- Dusty: one phone per truck, run by the live crew lead. Start, finish, and
-- skip will call private.is_live_crew_lead. This file uses that helper for
-- the photo bucket. A demoted lead fails because the check reads memberships
-- now, not the JWT role and not a lead id copied onto the visit.
--
-- Dusty: an after photo is required on every visit. There is no
-- require_after_photo switch. private.reject_completed_status still rejects
-- jobs.status = completed. The visit trigger visits_reject_completed is
-- replaced here by a BEFORE INSERT/UPDATE guard that allows completion only
-- when an after-photo row and its uploaded file both exist.
--
-- Dusty: crews contact the office only. These tables have no phone, email,
-- or billing columns, and no price, cost, or margin columns.
--
-- If the office cancels a visit the crew already completed, the completion
-- stays and visits.completed_after_cancel is set. The same flag is set when
-- a completion arrives after the office already cancelled.
--
-- One in-progress or paused visit per crew counts only visits on the same
-- scheduled date. A visit left active on an earlier day does not block
-- today. crew_sync in PR B is the recovery path for that past-day visit.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.time_entry_kind as enum ('job', 'pause');

create type public.visit_photo_kind as enum ('before', 'after', 'issue', 'upsell');

create type public.enhancement_tag as enum (
  'aeration', 'overseed', 'mulch', 'shrub_tree', 'drainage', 'other'
);

create type public.enhancement_status as enum ('new', 'quoted', 'dismissed');

create type public.visit_event_kind as enum (
  'started', 'paused', 'resumed', 'finished', 'reopened', 'skipped'
);

-- ---------------------------------------------------------------------------
-- Completion flag. Office cancel must not erase a crew completion.
-- ---------------------------------------------------------------------------
alter table public.visits
  add column completed_after_cancel boolean not null default false;

alter table public.visits
  add constraint visits_completed_after_cancel_status check (
    completed_after_cancel = false
    or status = 'completed'::public.visit_status
  );

alter table public.visits
  add constraint visits_completed_has_timestamp check (
    status <> 'completed'::public.visit_status
    or completed_at is not null
  );

-- ---------------------------------------------------------------------------
-- Time entries. One phone per truck: crew_id is the truck. profile_id is the
-- lead who tapped, when we know them. visit_id stays nullable so a later
-- drive or break kind can omit it. job and pause always name a visit.
-- ---------------------------------------------------------------------------
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  kind public.time_entry_kind not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  client_id uuid not null,
  device_clock_skewed boolean not null default false,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_ended_after_start check (
    ended_at is null or ended_at >= started_at
  ),
  constraint time_entries_visit_for_job_time check (
    kind not in ('job'::public.time_entry_kind, 'pause'::public.time_entry_kind)
    or visit_id is not null
  )
);

create index time_entries_org_id_idx on public.time_entries (org_id);
create index time_entries_crew_id_idx on public.time_entries (crew_id);
create index time_entries_visit_id_idx on public.time_entries (visit_id);
create index time_entries_profile_id_idx on public.time_entries (profile_id);

create unique index time_entries_org_client_id_key
  on public.time_entries (org_id, client_id);

create unique index time_entries_one_open_per_visit
  on public.time_entries (visit_id)
  where ended_at is null and visit_id is not null;

create trigger time_entries_set_updated_at
  before update on public.time_entries
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Visit photos. storage_path is the object key inside the private
-- visit-photos bucket: {org_id}/{visit_id}/{client_id}.jpg
-- ---------------------------------------------------------------------------
create table public.visit_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  kind public.visit_photo_kind not null,
  storage_path text not null,
  taken_at timestamptz not null,
  lat double precision,
  lng double precision,
  client_id uuid not null,
  device_clock_skewed boolean not null default false,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint visit_photos_storage_path_check check (
    storage_path = org_id::text || '/' || visit_id::text || '/' || client_id::text || '.jpg'
  ),
  constraint visit_photos_lat_range check (lat is null or lat between -90 and 90),
  constraint visit_photos_lng_range check (lng is null or lng between -180 and 180),
  constraint visit_photos_geo_pair check ((lat is null) = (lng is null))
);

create index visit_photos_org_id_idx on public.visit_photos (org_id);
create index visit_photos_visit_kind_idx on public.visit_photos (visit_id, kind);

create unique index visit_photos_org_client_id_key
  on public.visit_photos (org_id, client_id);

-- ---------------------------------------------------------------------------
-- Enhancement requests. One captured photo is the common case. photo_ids
-- holds that photo and any extras, all on the same visit. No prices.
-- ---------------------------------------------------------------------------
create table public.enhancement_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  tag public.enhancement_tag not null,
  note text,
  photo_ids uuid[] not null default '{}',
  status public.enhancement_status not null default 'new',
  quote_id uuid references public.quotes(id) on delete set null,
  client_id uuid not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enhancement_requests_note_len check (
    note is null or length(btrim(note)) between 1 and 2000
  ),
  constraint enhancement_requests_photo_ids_limit check (
    cardinality(photo_ids) <= 8
  )
);

create index enhancement_requests_org_id_idx on public.enhancement_requests (org_id);
create index enhancement_requests_visit_id_idx on public.enhancement_requests (visit_id);
create index enhancement_requests_property_id_idx on public.enhancement_requests (property_id);
create index enhancement_requests_quote_id_idx on public.enhancement_requests (quote_id);

create unique index enhancement_requests_org_client_id_key
  on public.enhancement_requests (org_id, client_id);

create index enhancement_requests_org_status_idx
  on public.enhancement_requests (org_id, status);

create trigger enhancement_requests_set_updated_at
  before update on public.enhancement_requests
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only crew audit. Direct updates and deletes are rejected. A cascade
-- from the visit (pg_trigger_depth() > 1) may remove the rows with the visit.
-- Money keys are refused at any depth. Crew payloads are notes and reasons.
-- ---------------------------------------------------------------------------
create or replace function private.jsonb_has_money_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if p_value is null then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_value) = 'object' then
    if p_value ?| array['price', 'cost', 'margin', 'amount', 'unit_cost', 'hourly_rate'] then
      return true;
    end if;
    for v_item in
      select e.value from pg_catalog.jsonb_each(p_value) as e
    loop
      if private.jsonb_has_money_key(v_item) then
        return true;
      end if;
    end loop;
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_value) = 'array' then
    for v_item in
      select e.value from pg_catalog.jsonb_array_elements(p_value) as e
    loop
      if private.jsonb_has_money_key(v_item) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create table public.visit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  kind public.visit_event_kind not null,
  profile_id uuid references public.profiles(id) on delete set null,
  client_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  device_clock_skewed boolean not null default false,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint visit_events_no_money check (
    not private.jsonb_has_money_key(payload)
  )
);

create index visit_events_org_id_idx on public.visit_events (org_id);
create index visit_events_visit_id_idx on public.visit_events (visit_id);
create index visit_events_visit_occurred_idx on public.visit_events (visit_id, occurred_at);
create index visit_events_profile_id_idx on public.visit_events (profile_id);

create unique index visit_events_org_client_id_key
  on public.visit_events (org_id, client_id);

-- ---------------------------------------------------------------------------
-- Same-org parents. Profiles are checked as active field members.
-- ---------------------------------------------------------------------------
create trigger time_entries_crew_org
  before insert or update of org_id, crew_id on public.time_entries
  for each row execute function private.child_org_guard('crews', 'crew_id');
create trigger time_entries_visit_org
  before insert or update of org_id, visit_id on public.time_entries
  for each row execute function private.child_org_guard('visits', 'visit_id');

create trigger visit_photos_visit_org
  before insert or update of org_id, visit_id on public.visit_photos
  for each row execute function private.child_org_guard('visits', 'visit_id');

create trigger enhancement_requests_visit_org
  before insert or update of org_id, visit_id on public.enhancement_requests
  for each row execute function private.child_org_guard('visits', 'visit_id');
create trigger enhancement_requests_property_org
  before insert or update of org_id, property_id on public.enhancement_requests
  for each row execute function private.child_org_guard('properties', 'property_id');
create trigger enhancement_requests_quote_org
  before insert or update of org_id, quote_id on public.enhancement_requests
  for each row execute function private.child_org_guard('quotes', 'quote_id');

create trigger visit_events_visit_org
  before insert or update of org_id, visit_id on public.visit_events
  for each row execute function private.child_org_guard('visits', 'visit_id');

-- True when auth.uid() is this crew's default lead AND that person is still
-- an active crew_lead member. JWT org_role is not consulted. Demotion fails
-- closed even if default_lead_id has not been rewritten yet.
create or replace function private.is_live_crew_lead(target_org uuid, target_crew uuid)
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
       from public.crews c
       join public.memberships m
         on m.org_id = c.org_id
        and m.user_id = c.default_lead_id
       where c.org_id = target_org
         and c.id = target_crew
         and c.default_lead_id = (select auth.uid())
         and m.status = 'active'
         and m.role = 'crew_lead'::public.org_role
     );
$$;

create or replace function private.time_entries_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crew uuid;
begin
  if new.profile_id is not null then
    perform private.assert_active_member(new.org_id, new.profile_id);
  end if;

  if new.visit_id is not null then
    select r.crew_id into v_crew
    from public.visits v
    left join public.routes r
      on r.id = v.route_id
     and r.org_id = v.org_id
    where v.id = new.visit_id
      and v.org_id = new.org_id;

    if v_crew is not null and v_crew is distinct from new.crew_id then
      raise exception 'time entry crew must be the visit crew' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger time_entries_before_write
  before insert or update of org_id, crew_id, visit_id, profile_id
  on public.time_entries
  for each row execute function private.time_entries_before_write();

create or replace function private.enhancement_requests_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo uuid;
begin
  if not exists (
    select 1
    from public.visits v
    where v.id = new.visit_id
      and v.org_id = new.org_id
      and v.property_id = new.property_id
  ) then
    raise exception 'enhancement property must match the visit' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(coalesce(new.photo_ids, '{}'::uuid[])) as pid
    where pid is null
  ) then
    raise exception 'enhancement photo must belong to this visit' using errcode = '23514';
  end if;

  if (
    select count(*)
    from unnest(coalesce(new.photo_ids, '{}'::uuid[])) as pid
  ) is distinct from (
    select count(distinct pid)
    from unnest(coalesce(new.photo_ids, '{}'::uuid[])) as pid
  ) then
    raise exception 'enhancement photos must be unique' using errcode = '23514';
  end if;

  foreach v_photo in array coalesce(new.photo_ids, '{}'::uuid[])
  loop
    if not exists (
      select 1
      from public.visit_photos p
      where p.id = v_photo
        and p.org_id = new.org_id
        and p.visit_id = new.visit_id
    ) then
      raise exception 'enhancement photo must belong to this visit' using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

create trigger enhancement_requests_before_write
  before insert or update of org_id, visit_id, property_id, photo_ids
  on public.enhancement_requests
  for each row execute function private.enhancement_requests_before_write();

create or replace function private.visit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'visit events are append-only' using errcode = '42501';
end;
$$;

create trigger visit_events_append_only
  before update or delete on public.visit_events
  for each row execute function private.visit_events_append_only();

create or replace function private.visit_events_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is not null then
    perform private.assert_active_member(new.org_id, new.profile_id);
  end if;
  return new;
end;
$$;

create trigger visit_events_before_write
  before insert or update of org_id, profile_id on public.visit_events
  for each row execute function private.visit_events_before_write();

-- TRUNCATE skips row triggers. service_role also has no TRUNCATE grant.
-- The statement trigger still stops the table owner.
create or replace function private.crew_capture_reject_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'crew capture rows cannot be truncated' using errcode = '42501';
end;
$$;

create trigger visit_events_reject_truncate
  before truncate on public.visit_events
  for each statement execute function private.crew_capture_reject_truncate();

-- A completed visit keeps at least one after photo. Cascades from the visit
-- may remove the photo with the visit.
create or replace function private.visit_photos_keep_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if old.kind is distinct from 'after'::public.visit_photo_kind then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.visits v
    where v.id = old.visit_id
      and v.status = 'completed'::public.visit_status
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- This row still satisfies the visit, so the completed visit keeps an after photo.
  if tg_op = 'UPDATE'
     and new.kind = 'after'::public.visit_photo_kind
     and new.visit_id is not distinct from old.visit_id then
    return new;
  end if;

  if not exists (
    select 1
    from public.visit_photos p
    where p.visit_id = old.visit_id
      and p.kind = 'after'::public.visit_photo_kind
      and p.id is distinct from old.id
  ) then
    raise exception 'a completed visit keeps its after photo' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger visit_photos_keep_after
  before update of kind, visit_id or delete on public.visit_photos
  for each row execute function private.visit_photos_keep_after();

create trigger visit_photos_reject_truncate
  before truncate on public.visit_photos
  for each statement execute function private.crew_capture_reject_truncate();

-- A photo row names a file that is already in the private bucket.
create or replace function private.visit_photos_require_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.storage_path is not distinct from old.storage_path then
    return new;
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'visit-photos'
      and o.name = new.storage_path
  ) then
    raise exception 'visit photo file is missing' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger visit_photos_require_object
  before insert or update of storage_path on public.visit_photos
  for each row execute function private.visit_photos_require_object();

-- Replaces visits_reject_completed. Jobs keep private.reject_completed_status.
-- One in_progress or paused visit per crew on the same scheduled date. The
-- crew row is locked so two starts cannot both pass the check. A visit left
-- active on another day does not block today; crew_sync recovers it in PR B.
create or replace function private.visits_guard_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crew uuid;
begin
  if tg_op = 'UPDATE'
     and old.status = 'completed'::public.visit_status
     and new.status = 'cancelled'::public.visit_status then
    new.status := 'completed'::public.visit_status;
    new.completed_after_cancel := true;
    new.completed_at := coalesce(new.completed_at, old.completed_at, now());
  elsif new.status = 'completed'::public.visit_status
        and (
          tg_op = 'INSERT'
          or old.status is distinct from 'completed'::public.visit_status
        ) then
    if not exists (
      select 1
      from public.visit_photos p
      join storage.objects o
        on o.bucket_id = 'visit-photos'
       and o.name = p.storage_path
      where p.visit_id = new.id
        and p.org_id = new.org_id
        and p.kind = 'after'::public.visit_photo_kind
    ) then
      raise exception 'completing a visit requires an after photo' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and old.status = 'cancelled'::public.visit_status then
      new.completed_after_cancel := true;
    end if;
    if new.completed_at is null then
      new.completed_at := now();
    end if;
  elsif tg_op = 'UPDATE'
        and old.status = 'completed'::public.visit_status
        and new.status is distinct from 'completed'::public.visit_status then
    new.completed_after_cancel := false;
  end if;

  if new.status in (
       'in_progress'::public.visit_status,
       'paused'::public.visit_status
     )
     and new.route_id is not null then
    select r.crew_id into v_crew
    from public.routes r
    where r.id = new.route_id
      and r.org_id = new.org_id;

    if v_crew is not null then
      perform 1
      from public.crews c
      where c.id = v_crew
        and c.org_id = new.org_id
      for update;

      if exists (
        select 1
        from public.visits v
        join public.routes r on r.id = v.route_id
        where r.crew_id = v_crew
          and r.org_id = new.org_id
          and v.id is distinct from new.id
          and v.scheduled_date = new.scheduled_date
          and v.status in (
            'in_progress'::public.visit_status,
            'paused'::public.visit_status
          )
      ) then
        raise exception 'only one in-progress visit per crew' using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger visits_reject_completed on public.visits;

create trigger visits_guard_status
  before insert or update of status, route_id on public.visits
  for each row execute function private.visits_guard_status();

create or replace function private.routes_one_active_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.crew_id is not distinct from old.crew_id then
    return new;
  end if;

  if not exists (
    select 1
    from public.visits v
    where v.route_id = new.id
      and v.status in (
        'in_progress'::public.visit_status,
        'paused'::public.visit_status
      )
  ) then
    return new;
  end if;

  perform 1
  from public.crews c
  where c.id = new.crew_id
    and c.org_id = new.org_id
  for update;

  if exists (
    select 1
    from public.visits v
    join public.routes r on r.id = v.route_id
    where r.crew_id = new.crew_id
      and r.org_id = new.org_id
      and r.id is distinct from new.id
      and v.status in (
        'in_progress'::public.visit_status,
        'paused'::public.visit_status
      )
      and v.scheduled_date in (
        select mine.scheduled_date
        from public.visits mine
        where mine.route_id = new.id
          and mine.status in (
            'in_progress'::public.visit_status,
            'paused'::public.visit_status
          )
      )
  ) then
    raise exception 'only one in-progress visit per crew' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger routes_one_active_visit
  before update of crew_id on public.routes
  for each row execute function private.routes_one_active_visit();

-- A cancelled or scheduled visit can still carry the crew's record. Deleting
-- the job or agreement must not cascade those events, time entries, or photos
-- away. The status rules from the jobs migration stay.
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

  if tg_table_name = 'agreements' and exists (
    select 1
    from public.visits v
    where v.agreement_id = old.id
      and (
        exists (select 1 from public.visit_events e where e.visit_id = v.id)
        or exists (select 1 from public.time_entries t where t.visit_id = v.id)
        or exists (select 1 from public.visit_photos p where p.visit_id = v.id)
      )
  ) then
    raise exception 'an agreement with crew records cannot be deleted'
      using errcode = '22023';
  end if;

  if tg_table_name = 'jobs' and exists (
    select 1
    from public.visits v
    where v.job_id = old.id
      and (
        exists (select 1 from public.visit_events e where e.visit_id = v.id)
        or exists (select 1 from public.time_entries t where t.visit_id = v.id)
        or exists (select 1 from public.visit_photos p where p.visit_id = v.id)
      )
  ) then
    raise exception 'a job with crew records cannot be deleted'
      using errcode = '22023';
  end if;

  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Photo object key. Canonical lowercase uuid path, jpeg only.
-- ---------------------------------------------------------------------------
create or replace function private.visit_photo_path_parts(object_name text)
returns table (org_id uuid, visit_id uuid, client_id uuid)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org text;
  v_visit text;
  v_file text;
  v_client text;
begin
  if object_name is null or position('://' in object_name) > 0 then
    return;
  end if;
  if split_part(object_name, '/', 4) <> '' then
    return;
  end if;

  v_org := split_part(object_name, '/', 1);
  v_visit := split_part(object_name, '/', 2);
  v_file := split_part(object_name, '/', 3);

  if v_org !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_visit !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_file !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then
    return;
  end if;

  v_client := left(v_file, length(v_file) - 4);
  org_id := v_org::uuid;
  visit_id := v_visit::uuid;
  client_id := v_client::uuid;
  return next;
end;
$$;

create or replace function private.visit_photo_crew(target_org uuid, target_visit uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.crew_id
  from public.visits v
  join public.routes r
    on r.id = v.route_id
   and r.org_id = v.org_id
  where v.id = target_visit
    and v.org_id = target_org;
$$;

create or replace function private.can_write_visit_photo(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_visit uuid;
  v_crew uuid;
begin
  select p.org_id, p.visit_id
    into v_org, v_visit
  from private.visit_photo_path_parts(object_name) p;

  if v_org is null or v_visit is null then
    return false;
  end if;
  if v_org is distinct from private.current_org_id() then
    return false;
  end if;

  v_crew := private.visit_photo_crew(v_org, v_visit);
  if v_crew is null then
    return false;
  end if;

  return private.is_live_crew_lead(v_org, v_crew)
     and private.crew_can_read_visit(v_org, v_visit);
end;
$$;

create or replace function private.can_read_visit_photo(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_visit uuid;
begin
  select p.org_id, p.visit_id
    into v_org, v_visit
  from private.visit_photo_path_parts(object_name) p;

  if v_org is null or v_visit is null then
    return false;
  end if;
  if v_org is distinct from private.current_org_id() then
    return false;
  end if;
  if not exists (
    select 1
    from public.visits v
    where v.id = v_visit
      and v.org_id = v_org
  ) then
    return false;
  end if;

  if private.can_read_office_records(v_org) then
    return true;
  end if;

  return private.crew_can_read_visit(v_org, v_visit);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Authenticated clients read rows for office roles, or for a visit the
-- crew can already read. Field writes go through later security-definer RPCs,
-- not table INSERT. The photo bucket is the exception: the lead's phone
-- uploads the jpeg with the user session.
-- ---------------------------------------------------------------------------
alter table public.time_entries enable row level security;
alter table public.time_entries force row level security;
alter table public.visit_photos enable row level security;
alter table public.visit_photos force row level security;
alter table public.enhancement_requests enable row level security;
alter table public.enhancement_requests force row level security;
alter table public.visit_events enable row level security;
alter table public.visit_events force row level security;

create policy time_entries_select on public.time_entries
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or (
      visit_id is not null
      and private.crew_can_read_visit(org_id, visit_id)
    )
  );

create policy visit_photos_select on public.visit_photos
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );

create policy enhancement_requests_select on public.enhancement_requests
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );

create policy visit_events_select on public.visit_events
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );

revoke all on table
  public.time_entries,
  public.visit_photos,
  public.enhancement_requests,
  public.visit_events
from public, anon, authenticated;

grant select on table
  public.time_entries,
  public.visit_photos,
  public.enhancement_requests,
  public.visit_events
to authenticated;

grant select, insert, update, delete on table
  public.time_entries,
  public.visit_photos,
  public.enhancement_requests,
  public.visit_events
to service_role;

-- ---------------------------------------------------------------------------
-- Private bucket. Do not ALTER storage.objects; hosted Supabase owns it.
-- 460800 bytes is 450 KiB. The phone downscales before upload.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'visit-photos',
  'visit-photos',
  false,
  460800,
  array['image/jpeg']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists visit_photos_object_select on storage.objects;
create policy visit_photos_object_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'visit-photos'
    and private.can_read_visit_photo(name)
  );

drop policy if exists visit_photos_object_insert on storage.objects;
create policy visit_photos_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'visit-photos'
    and private.can_write_visit_photo(name)
  );

-- No update or delete policy. A lead can upload a new object and cannot
-- overwrite, rename, or remove one, including a completed visit's after photo.
drop policy if exists visit_photos_object_update on storage.objects;

-- ---------------------------------------------------------------------------
-- Office cancel of a completed visit uses the same status update as any
-- other cancel. visits_guard_status keeps the completion and sets the flag.
-- A second call, once that flag is set, does not append another note.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_visit(p_visit_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_reason text;
begin
  v_reason := btrim(coalesce(p_reason, ''));
  if length(v_reason) < 1 or length(v_reason) > 500 then
    raise exception 'a cancel reason is required' using errcode = '22023';
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

  if v_visit.status = 'completed'::public.visit_status
     and v_visit.completed_after_cancel then
    return;
  end if;
  if v_visit.status = 'cancelled'::public.visit_status then
    return;
  end if;

  update public.visits
  set status = 'cancelled',
      skip_reason = null,
      cancel_reason = 'office'
  where id = v_visit.id;

  insert into public.visit_office_notes (visit_id, org_id, note)
  values (v_visit.id, v_visit.org_id, v_reason)
  on conflict (visit_id) do update
    set note = case
      when length(coalesce(public.visit_office_notes.note, '')) > 0
      then public.visit_office_notes.note || E'\n' || excluded.note
      else excluded.note
    end;
end;
$$;

revoke all on function public.cancel_visit(uuid, text) from public, anon;
grant execute on function public.cancel_visit(uuid, text) to authenticated, service_role;

revoke all on function private.is_live_crew_lead(uuid, uuid) from public, anon;
revoke all on function private.visit_photo_path_parts(text) from public, anon;
revoke all on function private.visit_photo_crew(uuid, uuid) from public, anon;
revoke all on function private.can_write_visit_photo(text) from public, anon;
revoke all on function private.can_read_visit_photo(text) from public, anon;
revoke all on function private.time_entries_before_write() from public, anon;
revoke all on function private.enhancement_requests_before_write() from public, anon;
revoke all on function private.visit_events_append_only() from public, anon;
revoke all on function private.visit_photos_keep_after() from public, anon;
revoke all on function private.visits_guard_status() from public, anon;
revoke all on function private.routes_one_active_visit() from public, anon;
revoke all on function private.jsonb_has_money_key(jsonb) from public, anon;
revoke all on function private.visit_events_before_write() from public, anon;
revoke all on function private.crew_capture_reject_truncate() from public, anon;
revoke all on function private.visit_photos_require_object() from public, anon;

grant execute on function private.is_live_crew_lead(uuid, uuid) to authenticated, service_role;
grant execute on function private.visit_photo_path_parts(text) to authenticated, service_role;
grant execute on function private.visit_photo_crew(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_write_visit_photo(text) to authenticated, service_role;
grant execute on function private.can_read_visit_photo(text) to authenticated, service_role;
grant execute on function private.time_entries_before_write() to authenticated, service_role;
grant execute on function private.enhancement_requests_before_write() to authenticated, service_role;
grant execute on function private.visit_events_append_only() to authenticated, service_role;
grant execute on function private.visit_photos_keep_after() to authenticated, service_role;
grant execute on function private.visits_guard_status() to authenticated, service_role;
grant execute on function private.routes_one_active_visit() to authenticated, service_role;
grant execute on function private.jsonb_has_money_key(jsonb) to authenticated, service_role;
grant execute on function private.visit_events_before_write() to authenticated, service_role;
grant execute on function private.crew_capture_reject_truncate() to authenticated, service_role;
grant execute on function private.visit_photos_require_object() to authenticated, service_role;
