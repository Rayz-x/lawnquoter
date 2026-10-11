-- S02: org/agreement season windows, pause with resume_on, end agreement.
-- Defaults Apr 1–Nov 15. Generation skips out-of-season dates. Ending cancels
-- future scheduled visits and keeps completed history.

-- ---------------------------------------------------------------------------
-- Season columns
-- ---------------------------------------------------------------------------
alter table public.orgs
  add column if not exists season_start_month smallint not null default 4,
  add column if not exists season_start_day smallint not null default 1,
  add column if not exists season_end_month smallint not null default 11,
  add column if not exists season_end_day smallint not null default 15;

alter table public.orgs
  drop constraint if exists orgs_season_start_month_range,
  drop constraint if exists orgs_season_start_day_range,
  drop constraint if exists orgs_season_end_month_range,
  drop constraint if exists orgs_season_end_day_range,
  drop constraint if exists orgs_season_start_valid,
  drop constraint if exists orgs_season_end_valid;

alter table public.orgs
  add constraint orgs_season_start_month_range check (season_start_month between 1 and 12),
  add constraint orgs_season_start_day_range check (season_start_day between 1 and 31),
  add constraint orgs_season_end_month_range check (season_end_month between 1 and 12),
  add constraint orgs_season_end_day_range check (season_end_day between 1 and 31),
  add constraint orgs_season_start_valid check (
    make_date(2000, season_start_month, season_start_day) is not null
  ),
  add constraint orgs_season_end_valid check (
    make_date(2000, season_end_month, season_end_day) is not null
  );

alter table public.agreements
  add column if not exists season_start_month smallint,
  add column if not exists season_start_day smallint,
  add column if not exists season_end_month smallint,
  add column if not exists season_end_day smallint,
  add column if not exists resume_on date;

alter table public.agreements
  drop constraint if exists agreements_season_all_or_none,
  drop constraint if exists agreements_season_start_month_range,
  drop constraint if exists agreements_season_start_day_range,
  drop constraint if exists agreements_season_end_month_range,
  drop constraint if exists agreements_season_end_day_range,
  drop constraint if exists agreements_season_start_valid,
  drop constraint if exists agreements_season_end_valid;

alter table public.agreements
  add constraint agreements_season_all_or_none check (
    (
      season_start_month is null
      and season_start_day is null
      and season_end_month is null
      and season_end_day is null
    )
    or (
      season_start_month is not null
      and season_start_day is not null
      and season_end_month is not null
      and season_end_day is not null
    )
  ),
  add constraint agreements_season_start_month_range check (
    season_start_month is null or season_start_month between 1 and 12
  ),
  add constraint agreements_season_start_day_range check (
    season_start_day is null or season_start_day between 1 and 31
  ),
  add constraint agreements_season_end_month_range check (
    season_end_month is null or season_end_month between 1 and 12
  ),
  add constraint agreements_season_end_day_range check (
    season_end_day is null or season_end_day between 1 and 31
  ),
  add constraint agreements_season_start_valid check (
    season_start_month is null
    or make_date(2000, season_start_month, season_start_day) is not null
  ),
  add constraint agreements_season_end_valid check (
    season_end_month is null
    or make_date(2000, season_end_month, season_end_day) is not null
  );

-- ---------------------------------------------------------------------------
-- Cancel reasons for pause / end
-- ---------------------------------------------------------------------------
alter table public.visits drop constraint if exists visits_cancel_reason_known;
alter table public.visits
  add constraint visits_cancel_reason_known check (
    cancel_reason is null
    or cancel_reason in (
      'schedule_changed',
      'office',
      'agreement_ended',
      'agreement_paused',
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
-- Season helpers
-- ---------------------------------------------------------------------------
create or replace function private.date_in_season(
  p_date date,
  p_start_month integer,
  p_start_day integer,
  p_end_month integer,
  p_end_day integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_start_month * 100 + p_start_day) <= (p_end_month * 100 + p_end_day) then
      (extract(month from p_date)::integer * 100 + extract(day from p_date)::integer)
        between (p_start_month * 100 + p_start_day)
            and (p_end_month * 100 + p_end_day)
    else
      (extract(month from p_date)::integer * 100 + extract(day from p_date)::integer)
        >= (p_start_month * 100 + p_start_day)
      or (extract(month from p_date)::integer * 100 + extract(day from p_date)::integer)
        <= (p_end_month * 100 + p_end_day)
  end;
$$;

revoke all on function private.date_in_season(date, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function private.date_in_season(date, integer, integer, integer, integer)
  to authenticated, service_role;

create or replace function private.agreement_season(p_agreement public.agreements)
returns table (
  start_month integer,
  start_day integer,
  end_month integer,
  end_day integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  o public.orgs;
begin
  if p_agreement.season_start_month is not null then
    start_month := p_agreement.season_start_month;
    start_day := p_agreement.season_start_day;
    end_month := p_agreement.season_end_month;
    end_day := p_agreement.season_end_day;
    return next;
    return;
  end if;

  select * into o from public.orgs where id = p_agreement.org_id;
  start_month := o.season_start_month;
  start_day := o.season_start_day;
  end_month := o.season_end_month;
  end_day := o.season_end_day;
  return next;
end;
$$;

revoke all on function private.agreement_season(public.agreements) from public, anon, authenticated;
grant execute on function private.agreement_season(public.agreements) to authenticated, service_role;

-- Auto-activate paused agreements whose resume_on has arrived.
create or replace function private.resume_due_agreements(p_org_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with due as (
    update public.agreements a
    set status = 'active'::public.agreement_status,
        resume_on = null
    where a.status = 'paused'::public.agreement_status
      and a.resume_on is not null
      and a.resume_on <= private.org_local_today(a.org_id)
      and (p_org_id is null or a.org_id = p_org_id)
    returning a.id, a.org_id
  ),
  reopened as (
    update public.visits v
    set status = 'scheduled'::public.visit_status,
        cancel_reason = null
    from due
    where v.org_id = due.org_id
      and v.agreement_id = due.id
      and v.status = 'cancelled'::public.visit_status
      and v.cancel_reason = 'agreement_paused'
      and v.occurrence_date >= private.org_local_today(due.org_id)
    returning v.id
  )
  select count(*)::integer into v_n from due;

  return coalesce(v_n, 0);
end;
$$;

revoke all on function private.resume_due_agreements(uuid) from public, anon, authenticated;
grant execute on function private.resume_due_agreements(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- fill_agreement_visits: season filter + auto-resume
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
         and private.date_in_season(v_cursor, v_sm, v_sd, v_em, v_ed) then
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
      if private.date_in_season(v_cursor, v_sm, v_sd, v_em, v_ed) then
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

-- Nightly horizon: resume due pauses first, then extend active recurring.
create or replace function public.extend_visit_horizons()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_total integer := 0;
  v_n integer;
  v_through date;
  v_horizon integer := private.visit_horizon_days();
begin
  if auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform private.resume_due_agreements(null);

  for r in
    select a.id, a.org_id
    from public.agreements a
    where a.kind = 'recurring'::public.agreement_kind
      and a.status = 'active'::public.agreement_status
      and a.frequency is not null
    order by a.org_id, a.id
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'role', 'service_role',
        'app_metadata', jsonb_build_object('org_id', r.org_id::text)
      )::text,
      true
    );
    perform set_config('request.jwt.claim.role', 'service_role', true);

    v_through := private.org_local_today(r.org_id) + v_horizon;
    v_n := private.fill_agreement_visits(r.id, v_through);
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  return v_total;
end;
$$;

revoke all on function public.extend_visit_horizons() from public, anon, authenticated;
grant execute on function public.extend_visit_horizons() to service_role;

-- ---------------------------------------------------------------------------
-- Org / agreement season editors
-- ---------------------------------------------------------------------------
create or replace function public.update_org_season(
  p_start_month integer,
  p_start_day integer,
  p_end_month integer,
  p_end_day integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
begin
  if v_org is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_start_month is null or p_start_day is null or p_end_month is null or p_end_day is null then
    raise exception 'season dates are required' using errcode = '22023';
  end if;
  if make_date(2000, p_start_month, p_start_day) is null
     or make_date(2000, p_end_month, p_end_day) is null then
    raise exception 'season dates are invalid' using errcode = '22023';
  end if;

  update public.orgs
  set season_start_month = p_start_month,
      season_start_day = p_start_day,
      season_end_month = p_end_month,
      season_end_day = p_end_day
  where id = v_org;
end;
$$;

revoke all on function public.update_org_season(integer, integer, integer, integer)
  from public, anon;
grant execute on function public.update_org_season(integer, integer, integer, integer)
  to authenticated, service_role;

create or replace function public.update_agreement_season(
  p_agreement_id uuid,
  p_start_month integer default null,
  p_start_day integer default null,
  p_end_month integer default null,
  p_end_day integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_clear boolean;
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

  v_clear := p_start_month is null
    and p_start_day is null
    and p_end_month is null
    and p_end_day is null;

  if not v_clear then
    if p_start_month is null or p_start_day is null
       or p_end_month is null or p_end_day is null then
      raise exception 'season override needs start and end' using errcode = '22023';
    end if;
    if make_date(2000, p_start_month, p_start_day) is null
       or make_date(2000, p_end_month, p_end_day) is null then
      raise exception 'season dates are invalid' using errcode = '22023';
    end if;
  end if;

  update public.agreements
  set season_start_month = case when v_clear then null else p_start_month end,
      season_start_day = case when v_clear then null else p_start_day end,
      season_end_month = case when v_clear then null else p_end_month end,
      season_end_day = case when v_clear then null else p_end_day end
  where id = a.id;
end;
$$;

revoke all on function public.update_agreement_season(uuid, integer, integer, integer, integer)
  from public, anon;
grant execute on function public.update_agreement_season(uuid, integer, integer, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pause / resume / end
-- ---------------------------------------------------------------------------
create or replace function public.pause_agreement(
  p_agreement_id uuid,
  p_resume_on date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_today date;
begin
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
  if a.status = 'ended'::public.agreement_status then
    raise exception 'ended agreements cannot be paused' using errcode = '22023';
  end if;

  v_today := private.org_local_today(a.org_id);
  if p_resume_on is not null and p_resume_on < v_today then
    raise exception 'resume date cannot be in the past' using errcode = '22023';
  end if;

  update public.agreements
  set status = 'paused'::public.agreement_status,
      resume_on = p_resume_on
  where id = a.id;

  -- Cancel future untouched (still scheduled) visits during the pause window.
  update public.visits v
  set status = 'cancelled'::public.visit_status,
      cancel_reason = 'agreement_paused'
  where v.org_id = a.org_id
    and v.agreement_id = a.id
    and v.status = 'scheduled'::public.visit_status
    and v.occurrence_date >= v_today
    and (p_resume_on is null or v.occurrence_date < p_resume_on);
end;
$$;

revoke all on function public.pause_agreement(uuid, date) from public, anon;
grant execute on function public.pause_agreement(uuid, date) to authenticated, service_role;

create or replace function public.resume_agreement(p_agreement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_today date;
begin
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
  if a.status is distinct from 'paused'::public.agreement_status then
    raise exception 'only paused agreements can be resumed' using errcode = '22023';
  end if;

  update public.agreements
  set status = 'active'::public.agreement_status,
      resume_on = null
  where id = a.id;

  v_today := private.org_local_today(a.org_id);

  update public.visits v
  set status = 'scheduled'::public.visit_status,
      cancel_reason = null
  where v.org_id = a.org_id
    and v.agreement_id = a.id
    and v.status = 'cancelled'::public.visit_status
    and v.cancel_reason = 'agreement_paused'
    and v.occurrence_date >= v_today;

  if a.kind = 'recurring'::public.agreement_kind
     and exists (
       select 1 from public.jobs j where j.agreement_id = a.id and j.org_id = a.org_id
     ) then
    perform private.fill_agreement_visits(a.id, v_today + private.visit_horizon_days());
  end if;
end;
$$;

revoke all on function public.resume_agreement(uuid) from public, anon;
grant execute on function public.resume_agreement(uuid) to authenticated, service_role;

create or replace function public.end_agreement(
  p_agreement_id uuid,
  p_end_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_today date;
  v_end date;
begin
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
  if a.status = 'ended'::public.agreement_status then
    return;
  end if;

  v_today := private.org_local_today(a.org_id);
  v_end := coalesce(p_end_date, v_today);
  if v_end < a.start_date then
    raise exception 'end date is before the agreement starts' using errcode = '22023';
  end if;

  update public.agreements
  set status = 'ended'::public.agreement_status,
      end_date = v_end,
      resume_on = null
  where id = a.id;

  -- Cancel future untouched scheduled visits; keep completed / in-progress history.
  update public.visits v
  set status = 'cancelled'::public.visit_status,
      cancel_reason = 'agreement_ended'
  where v.org_id = a.org_id
    and v.agreement_id = a.id
    and v.status = 'scheduled'::public.visit_status
    and v.occurrence_date >= v_today;
end;
$$;

revoke all on function public.end_agreement(uuid, date) from public, anon;
grant execute on function public.end_agreement(uuid, date) to authenticated, service_role;
