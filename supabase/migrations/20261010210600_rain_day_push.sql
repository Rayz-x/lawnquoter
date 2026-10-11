-- S04: rain day action.
-- Office pushes a day/crew/selection to the next workday (Saturday off by
-- default). Collision with the property's next regular visit → weather skip,
-- not a double booking. No cascade. In-progress visits stay put. Pushed rows
-- keep identity (same id + occurrence_date).

-- Next calendar day that is a workday for the org.
-- Default workdays: Mon–Fri. Set orgs.settings.saturday_workday = true to
-- treat Saturday as a workday (Friday then pushes to Saturday).
create or replace function private.next_workday(p_org_id uuid, p_from date)
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
  if p_from is null then
    raise exception 'from date is required' using errcode = '22023';
  end if;

  select coalesce((o.settings ->> 'saturday_workday')::boolean, false)
    into v_saturday
  from public.orgs o
  where o.id = p_org_id;

  if not found then
    raise exception 'org not found' using errcode = 'P0002';
  end if;

  loop
    v_dow := extract(dow from v_day)::integer;
    -- 0 = Sunday, 6 = Saturday
    if v_dow between 1 and 5 then
      return v_day;
    end if;
    if v_saturday and v_dow = 6 then
      return v_day;
    end if;
    v_day := v_day + 1;
    v_n := v_n + 1;
    if v_n > 14 then
      raise exception 'could not find a workday' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function private.next_workday(uuid, date) from public, anon, authenticated;
grant execute on function private.next_workday(uuid, date) to service_role;

-- Earliest upcoming regular visit for the property after p_after (by occurrence).
create or replace function private.property_next_regular_visit(
  p_org_id uuid,
  p_property_id uuid,
  p_after date,
  p_exclude_visit uuid
)
returns public.visits
language sql
stable
set search_path = ''
as $$
  select v.*
  from public.visits v
  where v.org_id = p_org_id
    and v.property_id = p_property_id
    and v.id is distinct from p_exclude_visit
    and v.status not in (
      'cancelled'::public.visit_status,
      'skipped'::public.visit_status,
      'cant_complete'::public.visit_status
    )
    and v.occurrence_date > p_after
  order by v.occurrence_date, v.created_at, v.id
  limit 1;
$$;

revoke all on function private.property_next_regular_visit(uuid, uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function private.property_next_regular_visit(uuid, uuid, date, uuid)
  to service_role;

-- Push scheduled visits for a service day (optionally one crew / a selection)
-- to the next workday. Returns a summary jsonb.
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
  v_visit public.visits;
  v_next public.visits;
  v_crew uuid;
  v_pushed uuid[] := array[]::uuid[];
  v_skipped uuid[] := array[]::uuid[];
  v_untouched uuid[] := array[]::uuid[];
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
    -- Only scheduled stops move. In-progress (and anything else) stays put.
    if v_visit.status is distinct from 'scheduled'::public.visit_status then
      v_untouched := v_untouched || v_visit.id;
      continue;
    end if;

    -- Collision: target day is already the property's next regular visit.
    v_next := private.property_next_regular_visit(
      v_org,
      v_visit.property_id,
      v_visit.occurrence_date,
      v_visit.id
    );

    if v_next.id is not null
       and (
         v_next.occurrence_date = v_target
         or v_next.scheduled_date = v_target
       )
    then
      update public.visits
      set status = 'skipped'::public.visit_status,
          skip_reason = 'weather'::public.visit_skip_reason
      where id = v_visit.id;
      v_skipped := v_skipped || v_visit.id;
      continue;
    end if;

    -- Also refuse a double if any other non-cancelled visit for the property
    -- is already on the target scheduled day (no cascade onto those rows).
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
        and coalesce(other.scheduled_date, other.occurrence_date) = v_target
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
      perform public.assign_visit(v_visit.id, v_crew, v_target, 0);
    else
      update public.visits
      set scheduled_date = v_target,
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
    'untouched', to_jsonb(v_untouched)
  );
end;
$$;

revoke all on function public.office_rain_day_push(date, uuid, uuid[]) from public, anon;
grant execute on function public.office_rain_day_push(date, uuid, uuid[]) to authenticated, service_role;
