-- property_set_geometry treats a null argument as "keep the current value",
-- and PostgREST cannot round-trip geography. Clearing a stale geocode has to
-- happen in SQL. Security invoker so the properties update policy still applies.

create or replace function public.property_clear_geometry(p_property uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.properties set
    location = null,
    parcel = null,
    footprint = null,
    place_id = null,
    parcel_apn = null,
    parcel_source = 'unknown',
    footprint_source = 'unknown',
    lot_sqft = null,
    building_sqft = null
  where id = p_property;
  if not found then
    raise exception 'property not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.property_clear_geometry(uuid) from public;
grant execute on function public.property_clear_geometry(uuid) to authenticated;
