-- bid_lines has no property_id. Checking new.property_id there aborts the insert.

create or replace function private.bids_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'bid_packages' then
    if not exists (select 1 from public.accounts a where a.id = new.account_id and a.org_id = new.org_id) then
      raise exception 'account must belong to the same org' using errcode = '23503';
    end if;
  elsif tg_table_name in ('bid_sites', 'bid_lines', 'site_walk_notes', 'takeoff_imports') then
    if not exists (select 1 from public.bid_packages p where p.id = new.package_id and p.org_id = new.org_id) then
      raise exception 'bid package must belong to the same org' using errcode = '23503';
    end if;
  end if;
  if tg_table_name in ('bid_sites', 'site_walk_notes', 'takeoff_imports') then
    if new.property_id is not null and not exists (
      select 1 from public.properties r where r.id = new.property_id and r.org_id = new.org_id
    ) then
      raise exception 'property must belong to the same org' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;
