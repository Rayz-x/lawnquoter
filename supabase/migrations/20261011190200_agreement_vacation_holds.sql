-- S03 (renumbered after 20261011190100; fill_agreement_visits merged with
-- 20261010217200's season skip so holds and out-of-season dates both skip).
-- S03: vacation holds and weekday change from a date (issue #83).
--
-- Holds are inclusive date ranges on an agreement. Visits in the range are
-- cancelled with cancel_reason vacation and are not made up. Generation and
-- schedule-change reopen skip held dates so a weekday change cannot put a
-- visit back into a held week. Change-week uniqueness still comes from
-- update_agreement_schedule + fill_agreement_visits (one live visit per ISO week).

-- ---------------------------------------------------------------------------
-- cancel_reason: vacation
-- ---------------------------------------------------------------------------
alter table public.visits
  drop constraint if exists visits_cancel_reason_known;

alter table public.visits
  add constraint visits_cancel_reason_known check (
    cancel_reason is null
    or cancel_reason in (
      'schedule_changed',
      'office',
      'agreement_ended',
      'agreement_paused',
      'vacation',
      'gate_locked',
      'dog_loose',
      'customer_skip',
      'weather',
      'equipment',
      'unsafe',
      'other'
    )
  );

-- ---------------------------------------------------------------------------
-- agreement_holds
-- ---------------------------------------------------------------------------
create table public.agreement_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agreement_holds_range check (end_date >= start_date),
  constraint agreement_holds_note_len check (
    note is null or length(btrim(note)) between 1 and 500
  )
);

create index agreement_holds_agreement_dates_idx
  on public.agreement_holds (org_id, agreement_id, start_date, end_date);

create trigger agreement_holds_set_updated_at
  before update on public.agreement_holds
  for each row execute function private.set_updated_at();

create trigger agreement_holds_agreement_org
  before insert or update of org_id, agreement_id on public.agreement_holds
  for each row execute function private.child_org_guard('agreements', 'agreement_id');

alter table public.agreement_holds enable row level security;
alter table public.agreement_holds force row level security;

create policy agreement_holds_select on public.agreement_holds
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

create policy agreement_holds_delete on public.agreement_holds
  for delete to authenticated
  using ((select private.can_dispatch(org_id)));

revoke all on table public.agreement_holds from public, anon, authenticated;
grant select, delete on table public.agreement_holds to authenticated;
grant all on table public.agreement_holds to service_role;

-- ---------------------------------------------------------------------------
-- Hold helpers
-- ---------------------------------------------------------------------------
create or replace function private.agreement_date_on_hold(
  p_agreement_id uuid,
  p_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agreement_holds h
    where h.agreement_id = p_agreement_id
      and p_date between h.start_date and h.end_date
  );
$$;

revoke all on function private.agreement_date_on_hold(uuid, date)
  from public, anon, authenticated;
grant execute on function private.agreement_date_on_hold(uuid, date)
  to authenticated, service_role;

-- Cancel scheduled visits in [start, end] (inclusive). Not made up.
create or replace function public.hold_agreement_visits(
  p_agreement_id uuid,
  p_start_date date,
  p_end_date date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_note text;
  v_hold_id uuid;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'hold start and end dates are required' using errcode = '22023';
  end if;
  if p_end_date < p_start_date then
    raise exception 'hold end must be on or after the start' using errcode = '22023';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 500 then
    raise exception 'hold note must be 500 characters or fewer' using errcode = '22023';
  end if;

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
    raise exception 'ended agreements cannot be held' using errcode = '22023';
  end if;

  insert into public.agreement_holds (
    org_id, agreement_id, start_date, end_date, note
  ) values (
    a.org_id, a.id, p_start_date, p_end_date, v_note
  )
  returning id into v_hold_id;

  update public.visits v
  set status = 'cancelled',
      skip_reason = null,
      cancel_reason = 'vacation'
  where v.org_id = a.org_id
    and v.agreement_id = a.id
    and v.status = 'scheduled'::public.visit_status
    and (
      v.occurrence_date between p_start_date and p_end_date
      or (
        v.scheduled_date is not null
        and v.scheduled_date between p_start_date and p_end_date
      )
    );

  if v_note is not null then
    insert into public.visit_office_notes (visit_id, org_id, note)
    select v.id, a.org_id, v_note
    from public.visits v
    where v.org_id = a.org_id
      and v.agreement_id = a.id
      and v.cancel_reason = 'vacation'
      and (
        v.occurrence_date between p_start_date and p_end_date
        or (
          v.scheduled_date is not null
          and v.scheduled_date between p_start_date and p_end_date
        )
      )
    on conflict (visit_id) do update
      set note = case
        when length(coalesce(public.visit_office_notes.note, '')) > 0
        then public.visit_office_notes.note || E'\n' || excluded.note
        else excluded.note
      end;
  end if;

  return v_hold_id;
end;
$$;

revoke all on function public.hold_agreement_visits(uuid, date, date, text)
  from public, anon;
grant execute on function public.hold_agreement_visits(uuid, date, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generation skips held dates
-- ---------------------------------------------------------------------------
create or replace function private.fill_agreement_visits(p_agreement_id uuid, p_through date)
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
  v_sm integer;
  v_sd integer;
  v_em integer;
  v_ed integer;
  v_season record;
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
  if a.kind::text is distinct from 'recurring' or a.frequency is null then
    raise exception 'not a recurring agreement' using errcode = '22023';
  end if;
  if a.frequency::text not in ('weekly', 'biweekly', 'monthly') then
    raise exception 'not a recurring agreement' using errcode = '22023';
  end if;

  v_today := private.org_local_today(a.org_id);

  -- Resume date arrived: activate before generating.
  if a.status = 'paused'::public.agreement_status
     and a.resume_on is not null
     and a.resume_on <= v_today then
    update public.agreements
    set status = 'active'::public.agreement_status,
        resume_on = null
    where id = a.id;
    a.status := 'active'::public.agreement_status;
    a.resume_on := null;

    -- Reopen visits cancelled for this pause; the occurrence unique key
    -- would otherwise block fill from recreating those dates.
    update public.visits v
    set status = 'scheduled'::public.visit_status,
        cancel_reason = null
    where v.org_id = a.org_id
      and v.agreement_id = a.id
      and v.status = 'cancelled'::public.visit_status
      and v.cancel_reason = 'agreement_paused'
      and v.occurrence_date >= v_today;
  end if;

  if a.status::text is distinct from 'active' then
    raise exception 'agreement is not active' using errcode = '22023';
  end if;

  select * into v_season from private.agreement_season(a);
  v_sm := v_season.start_month;
  v_sd := v_season.start_day;
  v_em := v_season.end_month;
  v_ed := v_season.end_day;

  v_org := a.org_id;
  v_agreement := a.id;
  v_quote := a.quote_id;
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
      if v_cursor >= v_from
         and private.date_in_season(v_cursor, v_sm, v_sd, v_em, v_ed)
         and not private.agreement_date_on_hold(v_agreement, v_cursor) then
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
      if private.date_in_season(v_cursor, v_sm, v_sd, v_em, v_ed)
         and not private.agreement_date_on_hold(v_agreement, v_cursor) then
        v_dates := v_dates || v_cursor;
      end if;
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
    where not exists (
      select 1
      from public.visits existing
      where existing.org_id = v_org
        and existing.agreement_id = v_agreement
        and existing.status <> 'cancelled'::public.visit_status
        and existing.occurrence_date is distinct from d
        and date_trunc('week', existing.occurrence_date::timestamp)
          = date_trunc('week', d::timestamp)
    )
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
    select 1 from public.visit_tasks t where t.visit_id = v_template
  ) then
    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, sort
    )
    select
      v_org, n.id, t.label, t.quantity_text, t.notes_crew, t.source_line_item_id, t.sort
    from unnest(v_new_ids) as n(id)
    cross join public.visit_tasks t
    where t.visit_id = v_template;
  elsif v_quote is not null then
    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, sort
    )
    select
      v_org, n.id, s.label, s.quantity_text, s.notes_crew, s.item_id, s.sort
    from unnest(v_new_ids) as n(id)
    cross join private.accepted_quote_task_sources(v_quote) s;
  end if;

  return cardinality(v_new_ids);
end;
$$;

revoke all on function private.fill_agreement_visits(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule change: do not reopen or keep dates that sit on a hold
-- ---------------------------------------------------------------------------
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
  v_today date;
  v_changed boolean;
  v_anchor date;
  v_step integer;
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
  v_changed := a.kind is distinct from v_kind
    or a.frequency is distinct from v_frequency
    or a.preferred_dow is distinct from p_preferred_dow
    or a.start_date is distinct from p_start_date;

  update public.agreements
  set kind = v_kind,
      frequency = v_frequency,
      preferred_dow = p_preferred_dow,
      start_date = p_start_date
  where id = a.id;

  -- A day, frequency, kind, or start-date change must not leave the old series
  -- scheduled. Visits that still fall on the new cadence stay. Future
  -- unassigned visits cancelled with cancel_reason schedule_changed are
  -- opened again when they land on the new cadence and that week has no
  -- other live visit — unless the date is on a vacation hold. Assigned
  -- visits stay on their route. One-time cancels the future unassigned
  -- series and does not generate a replacement.
  if v_changed then
    v_today := private.org_local_today(a.org_id);
    if v_kind = 'recurring'::public.agreement_kind
       and v_frequency in ('weekly'::public.agreement_frequency, 'biweekly'::public.agreement_frequency) then
      v_step := case when v_frequency = 'biweekly'::public.agreement_frequency then 14 else 7 end;
      v_anchor := p_start_date
        + ((p_preferred_dow - extract(dow from p_start_date)::integer + 7) % 7);
    end if;

    update public.visits v
    set status = 'cancelled',
        cancel_reason = 'schedule_changed'
    where v.org_id = a.org_id
      and v.agreement_id = a.id
      and v.status = 'scheduled'::public.visit_status
      and v.route_id is null
      and v.occurrence_date >= v_today
      and not (
        v_kind = 'recurring'::public.agreement_kind
        and v.occurrence_date >= p_start_date
        and (a.end_date is null or v.occurrence_date <= a.end_date)
        and not private.agreement_date_on_hold(a.id, v.occurrence_date)
        and (
          (
            v_frequency = 'monthly'::public.agreement_frequency
            and exists (
              select 1
              from generate_series(0, 600) as n
              where (p_start_date + make_interval(months => n))::date = v.occurrence_date
            )
          )
          or (
            v_frequency in ('weekly'::public.agreement_frequency, 'biweekly'::public.agreement_frequency)
            and v_anchor is not null
            and v_step is not null
            and v.occurrence_date >= v_anchor
            and ((v.occurrence_date - v_anchor) % v_step) = 0
          )
        )
      );

    update public.visits v
    set status = 'scheduled',
        cancel_reason = null
    where v.org_id = a.org_id
      and v.agreement_id = a.id
      and v.status = 'cancelled'::public.visit_status
      and v.cancel_reason = 'schedule_changed'
      and v.route_id is null
      and v.occurrence_date >= v_today
      and v_kind = 'recurring'::public.agreement_kind
      and v.occurrence_date >= p_start_date
      and (a.end_date is null or v.occurrence_date <= a.end_date)
      and not private.agreement_date_on_hold(a.id, v.occurrence_date)
      and (
        (
          v_frequency = 'monthly'::public.agreement_frequency
          and exists (
            select 1
            from generate_series(0, 600) as n
            where (p_start_date + make_interval(months => n))::date = v.occurrence_date
          )
        )
        or (
          v_frequency in ('weekly'::public.agreement_frequency, 'biweekly'::public.agreement_frequency)
          and v_anchor is not null
          and v_step is not null
          and v.occurrence_date >= v_anchor
          and ((v.occurrence_date - v_anchor) % v_step) = 0
        )
      )
      and not exists (
        select 1
        from public.visits existing
        where existing.org_id = v.org_id
          and existing.agreement_id = v.agreement_id
          and existing.status <> 'cancelled'::public.visit_status
          and existing.occurrence_date is distinct from v.occurrence_date
          and date_trunc('week', existing.occurrence_date::timestamp)
            = date_trunc('week', v.occurrence_date::timestamp)
      );

    if v_kind = 'recurring'::public.agreement_kind
       and exists (
         select 1
         from public.jobs j
         where j.agreement_id = a.id
           and j.org_id = a.org_id
       ) then
      perform private.fill_agreement_visits(a.id, v_today + 56);
    end if;
  end if;
end;
$$;

revoke all on function public.update_agreement_schedule(uuid, text, text, integer, date)
  from public, anon;
grant execute on function public.update_agreement_schedule(uuid, text, text, integer, date)
  to authenticated, service_role;
