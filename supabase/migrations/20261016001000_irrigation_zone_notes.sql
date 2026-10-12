-- irrigation_zone_notes is created by 20261016001200_crew_field_log_outbox.sql.
-- This log adds no columns beyond that table. Skip the create when the
-- table is already there, and do nothing when this file runs first.

do $$
begin
  if to_regclass('public.irrigation_zone_notes') is null then
    return;
  end if;
end
$$;
