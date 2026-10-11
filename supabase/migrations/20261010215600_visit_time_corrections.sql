-- Restacked on main tip (photo_pending/photo_lost from #163).
-- S17: visit time corrections with audit and flags (#97).
--
-- Raw device start/finish times are captured once and never change.
-- Effective started_at / completed_at can be corrected by the live lead
-- (crew_sync kind visit_correct_times, reason required) or by the office.
-- Each change writes visit_time_corrections (old/new/who/reason).
-- Flags: over_budget (wall time > budget_minutes) and clock_off
-- (effective differs from raw, or a skewed device clock was recorded).

-- ---------------------------------------------------------------------------
-- Columns on visits
-- ---------------------------------------------------------------------------
alter table public.visits
  add column raw_started_at timestamptz,
  add column raw_completed_at timestamptz,
  add column over_budget boolean not null default false,
  add column clock_off boolean not null default false;

comment on column public.visits.raw_started_at is
  'Immutable device start time captured on first start.';
comment on column public.visits.raw_completed_at is
  'Immutable device finish time captured on first finish.';

-- ---------------------------------------------------------------------------
-- Append-only correction audit
-- ---------------------------------------------------------------------------
create table public.visit_time_corrections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  old_started_at timestamptz,
  new_started_at timestamptz,
  old_completed_at timestamptz,
  new_completed_at timestamptz,
  reason text not null,
  corrected_by uuid references public.profiles(id) on delete set null,
  source text not null,
  status text not null default 'applied',
  client_id uuid,
  created_at timestamptz not null default now(),
  constraint visit_time_corrections_reason_len check (
    length(btrim(reason)) between 1 and 2000
  ),
  constraint visit_time_corrections_source_check check (
    source in ('crew', 'office')
  ),
  constraint visit_time_corrections_status_check check (
    status in ('pending', 'approved', 'applied')
  ),
  constraint visit_time_corrections_has_change check (
    old_started_at is distinct from new_started_at
    or old_completed_at is distinct from new_completed_at
  )
);

create index visit_time_corrections_org_id_idx
  on public.visit_time_corrections (org_id);
create index visit_time_corrections_visit_id_idx
  on public.visit_time_corrections (visit_id);

create unique index visit_time_corrections_org_client_id_key
  on public.visit_time_corrections (org_id, client_id)
  where client_id is not null;

alter table public.visit_time_corrections enable row level security;
alter table public.visit_time_corrections force row level security;

create policy visit_time_corrections_select on public.visit_time_corrections
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

revoke all on table public.visit_time_corrections from public, anon, authenticated;
grant select on table public.visit_time_corrections to authenticated;
grant all on table public.visit_time_corrections to service_role;

create or replace function private.visit_time_corrections_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Office may only flip pending → approved.
    if old.status = 'pending'
       and new.status = 'approved'
       and new.old_started_at is not distinct from old.old_started_at
       and new.new_started_at is not distinct from old.new_started_at
       and new.old_completed_at is not distinct from old.old_completed_at
       and new.new_completed_at is not distinct from old.new_completed_at
       and new.reason is not distinct from old.reason
       and new.corrected_by is not distinct from old.corrected_by
       and new.source is not distinct from old.source
       and new.client_id is not distinct from old.client_id
       and new.org_id is not distinct from old.org_id
       and new.visit_id is not distinct from old.visit_id
       and new.created_at is not distinct from old.created_at then
      return new;
    end if;
    raise exception 'visit time corrections are append-only' using errcode = '42501';
  end if;
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'visit time corrections are append-only' using errcode = '42501';
end;
$$;

create trigger visit_time_corrections_append_only
  before update or delete on public.visit_time_corrections
  for each row execute function private.visit_time_corrections_append_only();

revoke all on function private.visit_time_corrections_append_only() from public, anon;
grant execute on function private.visit_time_corrections_append_only()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Capture raw times once; reject later writes to raw_* columns.
-- ---------------------------------------------------------------------------
create or replace function private.visits_raw_times_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.raw_started_at is not null
       and new.raw_started_at is distinct from old.raw_started_at then
      raise exception 'raw device times are immutable' using errcode = '42501';
    end if;
    if old.raw_completed_at is not null
       and new.raw_completed_at is distinct from old.raw_completed_at then
      raise exception 'raw device times are immutable' using errcode = '42501';
    end if;
  end if;

  if new.started_at is not null and new.raw_started_at is null then
    new.raw_started_at := new.started_at;
  end if;
  if new.completed_at is not null and new.raw_completed_at is null then
    new.raw_completed_at := new.completed_at;
  end if;

  return new;
end;
$$;

create trigger visits_raw_times_guard
  before insert or update on public.visits
  for each row execute function private.visits_raw_times_guard();

revoke all on function private.visits_raw_times_guard() from public, anon;
grant execute on function private.visits_raw_times_guard()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Flags from effective times / device skew
-- ---------------------------------------------------------------------------
create or replace function private.refresh_visit_time_flags(p_visit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_minutes numeric;
  v_over boolean;
  v_clock boolean;
begin
  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found then
    return;
  end if;

  v_minutes := case
    when v_visit.started_at is not null and v_visit.completed_at is not null
      then extract(epoch from (v_visit.completed_at - v_visit.started_at)) / 60.0
    else null
  end;

  v_over := v_visit.status = 'completed'::public.visit_status
    and v_visit.budget_minutes is not null
    and v_minutes is not null
    and ceil(v_minutes) > v_visit.budget_minutes;

  v_clock := (
      v_visit.started_at is distinct from v_visit.raw_started_at
      or v_visit.completed_at is distinct from v_visit.raw_completed_at
    )
    or exists (
      select 1
      from public.time_entries te
      where te.visit_id = v_visit.id
        and te.device_clock_skewed
    )
    or exists (
      select 1
      from public.visit_events ve
      where ve.visit_id = v_visit.id
        and ve.device_clock_skewed
    );

  update public.visits
  set over_budget = coalesce(v_over, false),
      clock_off = coalesce(v_clock, false)
  where id = v_visit.id
    and (
      over_budget is distinct from coalesce(v_over, false)
      or clock_off is distinct from coalesce(v_clock, false)
    );
end;
$$;

revoke all on function private.refresh_visit_time_flags(uuid) from public, anon, authenticated;
grant execute on function private.refresh_visit_time_flags(uuid) to service_role;

create or replace function private.visits_refresh_time_flags_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_visit_time_flags(new.id);
  return null;
end;
$$;

create trigger visits_refresh_time_flags
  after insert or update of started_at, completed_at, budget_minutes, status,
    raw_started_at, raw_completed_at
  on public.visits
  for each row execute function private.visits_refresh_time_flags_trg();

revoke all on function private.visits_refresh_time_flags_trg() from public, anon;
grant execute on function private.visits_refresh_time_flags_trg()
  to authenticated, service_role;

create or replace function private.time_entries_refresh_visit_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.visit_id is not null and new.device_clock_skewed then
    perform private.refresh_visit_time_flags(new.visit_id);
  end if;
  return null;
end;
$$;

create trigger time_entries_refresh_visit_flags
  after insert or update of device_clock_skewed
  on public.time_entries
  for each row execute function private.time_entries_refresh_visit_flags();

revoke all on function private.time_entries_refresh_visit_flags() from public, anon;
grant execute on function private.time_entries_refresh_visit_flags()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared apply of a time correction (crew or office)
-- ---------------------------------------------------------------------------
create or replace function private.apply_visit_time_correction(
  p_visit_id uuid,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_reason text,
  p_source text,
  p_client_id uuid,
  p_status text default 'applied'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new_start timestamptz;
  v_new_finish timestamptz;
begin
  if v_reason is null then
    raise exception 'a correction reason is required' using errcode = '22023';
  end if;
  if p_source not in ('crew', 'office') then
    raise exception 'correction source is not valid' using errcode = '22023';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from private.current_org_id() then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;

  if v_visit.started_at is null then
    raise exception 'that visit has no times to correct' using errcode = '22023';
  end if;

  v_new_start := coalesce(p_started_at, v_visit.started_at);
  v_new_finish := case
    when p_completed_at is not null then p_completed_at
    else v_visit.completed_at
  end;

  if p_started_at is null and p_completed_at is null then
    raise exception 'a start or finish time is required' using errcode = '22023';
  end if;

  if v_new_finish is not null and v_new_finish < v_new_start then
    raise exception 'finish must be on or after start' using errcode = '22023';
  end if;

  if v_new_start is not distinct from v_visit.started_at
     and v_new_finish is not distinct from v_visit.completed_at then
    raise exception 'correction must change a time' using errcode = '22023';
  end if;

  insert into public.visit_time_corrections (
    org_id, visit_id,
    old_started_at, new_started_at,
    old_completed_at, new_completed_at,
    reason, corrected_by, source, status, client_id
  ) values (
    v_visit.org_id, v_visit.id,
    v_visit.started_at, v_new_start,
    v_visit.completed_at, v_new_finish,
    v_reason, (select auth.uid()), p_source, coalesce(p_status, 'applied'), p_client_id
  );

  update public.visits
  set started_at = v_new_start,
      completed_at = v_new_finish
  where id = v_visit.id;
end;
$$;

revoke all on function private.apply_visit_time_correction(
  uuid, timestamptz, timestamptz, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function private.apply_visit_time_correction(
  uuid, timestamptz, timestamptz, text, text, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Crew sync path: visit_correct_times (handled in crew_apply wrapper)
-- ---------------------------------------------------------------------------
create or replace function private.crew_apply_correct_times(
  p_visit_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_device_now timestamptz,
  p_payload jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_crew uuid;
  v_claimed uuid;
  v_existing text;
  v_existing_visit uuid;
  v_started timestamptz;
  v_completed timestamptz;
begin
  if p_client_id is null or p_visit_id is null then
    raise exception 'a client_id, visit, and kind are required' using errcode = '22023';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from private.current_org_id() then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;

  select r.crew_id into v_crew
  from public.routes r
  where r.id = v_visit.route_id
    and r.org_id = v_visit.org_id;

  if v_crew is null or not private.is_live_crew_lead(v_visit.org_id, v_crew) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.crew_mutation_receipts (org_id, client_id, kind, visit_id)
  values (v_visit.org_id, p_client_id, 'visit_correct_times', v_visit.id)
  on conflict (org_id, client_id) do nothing
  returning client_id into v_claimed;

  if v_claimed is null then
    select kind, visit_id into v_existing, v_existing_visit
    from public.crew_mutation_receipts
    where org_id = v_visit.org_id
      and client_id = p_client_id;
    if v_existing is distinct from 'visit_correct_times'
       or v_existing_visit is distinct from v_visit.id then
      raise exception 'client_id was already used' using errcode = '22023';
    end if;
    return 'replayed';
  end if;

  begin
    v_started := (p_payload->>'started_at')::timestamptz;
  exception
    when others then
      raise exception 'start time is not valid' using errcode = '22023';
  end;
  begin
    v_completed := (p_payload->>'completed_at')::timestamptz;
  exception
    when others then
      raise exception 'finish time is not valid' using errcode = '22023';
  end;

  -- Clamp future phone clocks the same way start/finish do.
  if v_started is not null then
    v_started := least(v_started, pg_catalog.now());
  end if;
  if v_completed is not null then
    v_completed := least(v_completed, pg_catalog.now());
  end if;

  perform private.apply_visit_time_correction(
    v_visit.id,
    v_started,
    v_completed,
    p_payload->>'reason',
    'crew',
    p_client_id,
    'pending'
  );

  return 'applied';
end;
$$;

revoke all on function private.crew_apply_correct_times(
  uuid, uuid, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function private.crew_apply_correct_times(
  uuid, uuid, timestamptz, timestamptz, jsonb
) to service_role;

-- Route the new kind through the existing lead-at-time wrapper.
create or replace function private.crew_apply(
  p_kind text,
  p_visit_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_device_now timestamptz,
  p_payload jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_crew uuid;
  v_route_date date;
  v_at timestamptz;
begin
  select v.org_id, r.crew_id, r.date
    into v_org, v_crew, v_route_date
  from public.visits v
  left join public.routes r
    on r.id = v.route_id
   and r.org_id = v.org_id
  where v.id = p_visit_id;

  v_at := least(coalesce(p_occurred_at, pg_catalog.now()), pg_catalog.now());
  if v_org is not null then
    perform set_config('lawnquoter.lead_at', v_at::text, true);
    perform set_config(
      'lawnquoter.lead_date',
      coalesce(v_route_date, private.org_local_today(v_org))::text,
      true
    );
  end if;

  if p_kind = 'visit_correct_times' then
    return private.crew_apply_correct_times(
      p_visit_id, p_client_id, p_occurred_at, p_device_now, coalesce(p_payload, '{}'::jsonb)
    );
  end if;

  return private.crew_apply_impl(
    p_kind, p_visit_id, p_client_id, p_occurred_at, p_device_now, p_payload
  );
end;
$$;

revoke all on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Office edit / approve
-- ---------------------------------------------------------------------------
create or replace function public.office_correct_visit_times(
  p_visit_id uuid,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org
  from public.visits
  where id = p_visit_id;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform private.apply_visit_time_correction(
    p_visit_id,
    p_started_at,
    p_completed_at,
    p_reason,
    'office',
    null,
    'approved'
  );

  -- Approving an office edit also marks any pending crew corrections approved.
  update public.visit_time_corrections
  set status = 'approved'
  where visit_id = p_visit_id
    and status = 'pending';
end;
$$;

revoke all on function public.office_correct_visit_times(
  uuid, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.office_correct_visit_times(
  uuid, timestamptz, timestamptz, text
) to authenticated, service_role;

create or replace function public.office_approve_visit_time_correction(
  p_correction_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.visit_time_corrections;
begin
  select * into v_row
  from public.visit_time_corrections
  where id = p_correction_id
  for update;

  if not found or v_row.org_id is distinct from private.current_org_id() then
    raise exception 'correction not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_row.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_row.status is distinct from 'pending' then
    return;
  end if;

  update public.visit_time_corrections
  set status = 'approved'
  where id = v_row.id;
end;
$$;

revoke all on function public.office_approve_visit_time_correction(uuid)
  from public, anon;
grant execute on function public.office_approve_visit_time_correction(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Needs-attention flags bucket includes over_budget / clock_off
-- ---------------------------------------------------------------------------
create or replace function public.office_attention_tray(p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_as_of date;
  v_unassigned jsonb := '[]'::jsonb;
  v_overdue jsonb := '[]'::jsonb;
  v_reschedule jsonb := '[]'::jsonb;
  v_flags jsonb := '[]'::jsonb;
begin
  if v_org is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_read_office_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_as_of := coalesce(p_as_of, private.org_local_today(v_org));

  with base as (
    select
      v.id,
      v.property_id,
      v.scheduled_date,
      v.status::text as status,
      v.route_id,
      v.budget_minutes,
      v.completed_after_cancel,
      v.over_budget,
      v.clock_off,
      coalesce(j.title, 'Visit') as title,
      a.name as account_name,
      p.address_line1,
      p.city,
      case
        when v.photo_lost then 'Photo lost'
        when v.completed_after_cancel then 'Completed after cancel'
        when v.over_budget then 'Over budget'
        when v.clock_off then 'Clock off'
        when exists (
          select 1
          from public.enhancement_requests e
          where e.visit_id = v.id
            and e.org_id = v.org_id
            and e.status = 'new'::public.enhancement_status
        ) then (
          select 'Upsell: ' || e.tag::text
          from public.enhancement_requests e
          where e.visit_id = v.id
            and e.org_id = v.org_id
            and e.status = 'new'::public.enhancement_status
          order by e.received_at asc, e.created_at asc
          limit 1
        )
        else null
      end as reason,
      case
        when v.photo_lost
          or v.completed_after_cancel
          or v.over_budget
          or v.clock_off
          or exists (
            select 1
            from public.enhancement_requests e
            where e.visit_id = v.id
              and e.org_id = v.org_id
              and e.status = 'new'::public.enhancement_status
          )
          then 'flags'
        when v.status in (
          'skipped'::public.visit_status,
          'cant_complete'::public.visit_status
        )
          then 'needs_reschedule'
        when v.status in (
          'scheduled'::public.visit_status,
          'in_progress'::public.visit_status,
          'paused'::public.visit_status
        )
          and v.scheduled_date is not null
          and v.scheduled_date < v_as_of
          then 'overdue'
        when v.status = 'scheduled'::public.visit_status
          and v.route_id is null
          and (v.scheduled_date is null or v.scheduled_date >= v_as_of)
          then 'unassigned'
        else null
      end as bucket
    from public.visits v
    left join public.jobs j on j.id = v.job_id
    left join public.properties p on p.id = v.property_id
    left join public.accounts a on a.id = p.account_id
    where v.org_id = v_org
      and v.status <> 'cancelled'::public.visit_status
  ),
  items as (
    select
      bucket,
      jsonb_build_object(
        'id', id,
        'property_id', property_id,
        'scheduled_date', scheduled_date,
        'status', status,
        'title', title,
        'account_name', account_name,
        'address_line1', address_line1,
        'city', city,
        'budget_minutes', budget_minutes,
        'reason', reason
      ) as item
    from base
    where bucket is not null
  )
  select
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date') nulls first, item ->> 'title')
      filter (where bucket = 'unassigned'), '[]'::jsonb),
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date'), item ->> 'title')
      filter (where bucket = 'overdue'), '[]'::jsonb),
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date') nulls last, item ->> 'title')
      filter (where bucket = 'needs_reschedule'), '[]'::jsonb),
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date') nulls last, item ->> 'title')
      filter (where bucket = 'flags'), '[]'::jsonb)
  into v_unassigned, v_overdue, v_reschedule, v_flags
  from items;

  return jsonb_build_object(
    'as_of', v_as_of,
    'counts', jsonb_build_object(
      'unassigned', jsonb_array_length(v_unassigned),
      'overdue', jsonb_array_length(v_overdue),
      'needs_reschedule', jsonb_array_length(v_reschedule),
      'flags', jsonb_array_length(v_flags)
    ),
    'unassigned', v_unassigned,
    'overdue', v_overdue,
    'needs_reschedule', v_reschedule,
    'flags', v_flags
  );
end;
$$;
revoke all on function public.office_attention_tray(date) from public, anon;
grant execute on function public.office_attention_tray(date) to authenticated, service_role;
