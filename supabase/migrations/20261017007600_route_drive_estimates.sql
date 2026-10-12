-- Drive-time estimates for one crew day.
-- drive_minutes is the drive from the previous stop. The free nearest-neighbor
-- estimate is the default. A paid routing service is optional and stays off
-- until ROUTING_API_URL and ROUTING_API_KEY are set in the app.

alter table public.visits
  add column if not exists drive_minutes integer;

do $$
begin
  alter table public.visits
    add constraint visits_drive_minutes_nonnegative
    check (drive_minutes is null or drive_minutes >= 0);
exception
  when duplicate_object then null;
end
$$;

alter table public.routes
  add column if not exists optimized_at timestamptz;

alter table public.routes
  add column if not exists optimizer text;

do $$
begin
  alter table public.routes
    add constraint routes_optimizer_known
    check (optimizer is null or optimizer in ('heuristic', 'api'));
exception
  when duplicate_object then null;
end
$$;

-- A hand reorder changes sort without a new drive time. Drop the stale estimate.
create or replace function private.visits_clear_stale_drive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.sort is distinct from old.sort
    or new.route_id is distinct from old.route_id
  ) and new.drive_minutes is not distinct from old.drive_minutes then
    new.drive_minutes := null;
    update public.routes
    set optimized_at = null,
        optimizer = null
    where id = coalesce(new.route_id, old.route_id)
      and optimized_at is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists visits_clear_stale_drive on public.visits;
create trigger visits_clear_stale_drive
  before update of sort, route_id on public.visits
  for each row execute function private.visits_clear_stale_drive();

create or replace function public.route_stop_points(p_route_id uuid)
returns table (
  visit_id uuid,
  sort integer,
  lat double precision,
  lng double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select r.org_id into v_org
  from public.routes r
  where r.id = p_route_id;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'route not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select v.id,
         v.sort,
         extensions.st_y(p.location::extensions.geometry),
         extensions.st_x(p.location::extensions.geometry)
  from public.visits v
  join public.properties p on p.id = v.property_id
  where v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status
  order by v.sort, v.id;
end;
$$;

revoke all on function public.route_stop_points(uuid) from public, anon;
grant execute on function public.route_stop_points(uuid) to authenticated, service_role;

create or replace function public.apply_optimized_route(
  p_route_id uuid,
  p_visit_ids uuid[],
  p_drive_minutes integer[],
  p_optimizer text
)
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
  if p_optimizer is null or p_optimizer not in ('heuristic', 'api') then
    raise exception 'unknown optimizer' using errcode = '22023';
  end if;
  if p_visit_ids is null or p_drive_minutes is null
     or cardinality(p_visit_ids) < 2
     or cardinality(p_visit_ids) is distinct from cardinality(p_drive_minutes) then
    raise exception 'drive times must match the stop list' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_drive_minutes) as mins where mins is null or mins < 0) then
    raise exception 'drive times must be zero or more' using errcode = '22023';
  end if;
  if (
    select count(distinct picked)
    from unnest(p_visit_ids) as picked
  ) <> cardinality(p_visit_ids) then
    raise exception 'duplicate visit' using errcode = '22023';
  end if;

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
  if v_status in ('in_progress'::public.route_status, 'done'::public.route_status) then
    raise exception 'route cannot be changed' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.visits v
  where v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status;

  select count(*) into v_open
  from public.visits v
  where v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status
    and v.id = any(p_visit_ids);

  if v_total <> cardinality(p_visit_ids) or v_open <> v_total then
    raise exception 'order requires every scheduled visit on the route' using errcode = '22023';
  end if;

  update public.visits v
  set sort = u.ord::integer - 1,
      drive_minutes = u.mins
  from unnest(p_visit_ids, p_drive_minutes) with ordinality as u(id, mins, ord)
  where v.id = u.id
    and v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status;

  update public.routes
  set optimized_at = now(),
      optimizer = p_optimizer
  where id = p_route_id;
end;
$$;

revoke all on function public.apply_optimized_route(uuid, uuid[], integer[], text) from public, anon;
grant execute on function public.apply_optimized_route(uuid, uuid[], integer[], text) to authenticated, service_role;
