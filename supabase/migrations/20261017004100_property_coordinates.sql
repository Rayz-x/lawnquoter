-- Coordinates for the route-density map. Security invoker, so property RLS applies.

create or replace function public.property_coordinates(p_ids uuid[])
returns table (id uuid, lng double precision, lat double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id,
         extensions.st_x(p.location::extensions.geometry),
         extensions.st_y(p.location::extensions.geometry)
  from public.properties p
  where p.id = any(p_ids)
    and p.location is not null;
$$;

revoke all on function public.property_coordinates(uuid[]) from public, anon;
grant execute on function public.property_coordinates(uuid[]) to authenticated;
