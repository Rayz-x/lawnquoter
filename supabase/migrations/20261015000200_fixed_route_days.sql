-- Fixed route days. A locked agreement stays on its weekday.
-- Rain day moves it to the next same weekday. A different weekday is refused.
-- Starts from office_rain_day_push in 20261010210600 and keeps that behavior
-- for agreements that are not locked.

alter table public.agreements
  add column if not exists fixed_route_day boolean not null default false;

create or replace function private.agreements_clear_fixed_without_dow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.preferred_dow is null then
    new.fixed_route_day := false;
  end if;
  return new;
end;
$$;

drop trigger if exists agreements_clear_fixed_without_dow on public.agreements;
create trigger agreements_clear_fixed_without_dow
  before insert or update of preferred_dow, fixed_route_day on public.agreements
  for each row execute function private.agreements_clear_fixed_without_dow();

create or replace function private.next_fixed_route_day(
  p_org_id uuid,
  p_from date,
  p_dow integer
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_day date := p_from + 1;
  v_saturday boolean;
  v_dow integer;
  v_n integer := 0;
begin
  if p_from is null or p_dow is null or p_dow not between 0 and 6 then
    return null;
  end if;

  select coalesce((o.settings ->> 'saturday_workday')::boolean, false)
    into v_saturday
  from public.orgs o
  where o.id = p_org_id;

  if not found then
    return null;
  end if;

  while v_n < 14 loop
    v_dow := extract(dow from v_day)::integer;
    if v_dow = p_dow then
      if v_dow between 1 and 5 or (v_saturday and v_dow = 6) then
        return v_day;
      end if;
      return null;
    end if;
    v_day := v_day + 1;
    v_n := v_n + 1;
  end loop;
  return null;
end;
$$;

revoke all on function private.next_fixed_route_day(uuid, date, integer) from public, anon, authenticated;
grant execute on function private.next_fixed_route_day(uuid, date, integer) to service_role;

create or replace function private.visits_keep_fixed_route_day()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fixed boolean;
  v_dow smallint;
begin
  if new.scheduled_date is not distinct from old.scheduled_date then
    return new;
  end if;
  if new.agreement_id is null or new.scheduled_date is null then
    return new;
  end if;

  select a.fixed_route_day, a.preferred_dow
    into v_fixed, v_dow
  from public.agreements a
  where a.id = new.agreement_id;

  if coalesce(v_fixed, false)
     and v_dow is not null
     and extract(dow from new.scheduled_date)::integer <> v_dow then
    raise exception 'This visit stays on its route day' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists visits_keep_fixed_route_day on public.visits;
create trigger visits_keep_fixed_route_day
  before update of scheduled_date on public.visits
  for each row execute function private.visits_keep_fixed_route_day();

create or replace function public.set_agreement_fixed_route_day(
  p_agreement_id uuid,
  p_fixed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_dow smallint;
begin
  select a.org_id, a.preferred_dow
    into v_org, v_dow
  from public.agreements a
  where a.id = p_agreement_id
  for update;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(p_fixed, false) and v_dow is null then
    raise exception 'Pick a route day first' using errcode = '22023';
  end if;

  update public.agreements
  set fixed_route_day = coalesce(p_fixed, false)
  where id = p_agreement_id;
end;
$$;

revoke all on function public.set_agreement_fixed_route_day(uuid, boolean) from public, anon;
grant execute on function public.set_agreement_fixed_route_day(uuid, boolean) to authenticated, service_role;

-- Same rain-day rules as 20261010210600, plus a locked visit moves to its next weekday.
create or replace function public.office_rain_day_push(
  p_service_date date,
  p_crew_id uuid default null,
  p_visit_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_target date;
  v_move_to date;
  v_visit public.visits;
  v_next public.visits;
  v_crew uuid;
  v_fixed boolean;
  v_dow smallint;
  v_pushed uuid[] := array[]::uuid[];
  v_skipped uuid[] := array[]::uuid[];
  v_untouched uuid[] := array[]::uuid[];
  v_held uuid[] := array[]::uuid[];
begin
  if v_org is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_service_date is null then
    raise exception 'service date is required' using errcode = '22023';
  end if;

  if p_crew_id is not null and not exists (
    select 1
    from public.crews c
    where c.id = p_crew_id
      and c.org_id = v_org
  ) then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;

  v_target := private.next_workday(v_org, p_service_date);

  for v_visit in
    select v.*
    from public.visits v
    left join public.routes r on r.id = v.route_id
    where v.org_id = v_org
      and v.scheduled_date = p_service_date
      and (p_visit_ids is null or v.id = any(p_visit_ids))
      and (p_crew_id is null or r.crew_id = p_crew_id)
    order by v.sort, v.created_at, v.id
    for update of v
  loop
    if v_visit.status is distinct from 'scheduled'::public.visit_status then
      v_untouched := v_untouched || v_visit.id;
      continue;
    end if;

    v_move_to := v_target;
    v_fixed := false;
    v_dow := null;
    if v_visit.agreement_id is not null then
      select a.fixed_route_day, a.preferred_dow
        into v_fixed, v_dow
      from public.agreements a
      where a.id = v_visit.agreement_id;
      if coalesce(v_fixed, false) then
        v_move_to := private.next_fixed_route_day(v_org, p_service_date, v_dow);
        if v_move_to is null then
          v_held := v_held || v_visit.id;
          continue;
        end if;
      end if;
    end if;

    v_next := private.property_next_regular_visit(
      v_org,
      v_visit.property_id,
      v_visit.occurrence_date,
      v_visit.id
    );

    if v_next.id is not null
       and (
         v_next.occurrence_date = v_move_to
         or v_next.scheduled_date = v_move_to
       )
    then
      update public.visits
      set status = 'skipped'::public.visit_status,
          skip_reason = 'weather'::public.visit_skip_reason
      where id = v_visit.id;
      v_skipped := v_skipped || v_visit.id;
      continue;
    end if;

    if exists (
      select 1
      from public.visits other
      where other.org_id = v_org
        and other.property_id = v_visit.property_id
        and other.id is distinct from v_visit.id
        and other.status not in (
          'cancelled'::public.visit_status,
          'skipped'::public.visit_status,
          'cant_complete'::public.visit_status
        )
        and coalesce(other.scheduled_date, other.occurrence_date) = v_move_to
    ) then
      update public.visits
      set status = 'skipped'::public.visit_status,
          skip_reason = 'weather'::public.visit_skip_reason
      where id = v_visit.id;
      v_skipped := v_skipped || v_visit.id;
      continue;
    end if;

    v_crew := null;
    if v_visit.route_id is not null then
      select r.crew_id into v_crew
      from public.routes r
      where r.id = v_visit.route_id;
    elsif p_crew_id is not null then
      v_crew := p_crew_id;
    end if;

    if v_crew is not null then
      perform public.assign_visit(v_visit.id, v_crew, v_move_to, 0);
    else
      update public.visits
      set scheduled_date = v_move_to,
          route_id = null,
          sort = 0
      where id = v_visit.id;
    end if;

    v_pushed := v_pushed || v_visit.id;
  end loop;

  return jsonb_build_object(
    'service_date', p_service_date,
    'target_date', v_target,
    'pushed', to_jsonb(v_pushed),
    'skipped', to_jsonb(v_skipped),
    'untouched', to_jsonb(v_untouched),
    'held', to_jsonb(v_held)
  );
end;
$$;
