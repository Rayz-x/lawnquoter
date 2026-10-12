-- Drive time and distance feed travel zones. A per-service minimum can
-- only raise the company floor stored on the price list.

alter table public.properties
  add column if not exists drive_minutes numeric(6,1),
  add column if not exists drive_miles numeric(6,2);

alter table public.services
  add column if not exists minimum_price numeric(12,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_drive_minutes_check') then
    alter table public.properties
      add constraint properties_drive_minutes_check
      check (drive_minutes is null or (drive_minutes >= 0 and drive_minutes <= 600));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_drive_miles_check') then
    alter table public.properties
      add constraint properties_drive_miles_check
      check (drive_miles is null or (drive_miles >= 0 and drive_miles <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_minimum_price_check') then
    alter table public.services
      add constraint services_minimum_price_check
      check (minimum_price is null or minimum_price >= 0);
  end if;
end $$;
