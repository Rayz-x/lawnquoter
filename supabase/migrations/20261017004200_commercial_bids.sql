-- Commercial bid packages, site walks, and takeoff imports.

create type public.bid_status as enum ('pre_bid', 'bidding', 'submitted', 'awarded', 'lost');
create type public.bid_frequency as enum ('once', 'weekly', 'biweekly', 'monthly', 'seasonal');

create table if not exists public.bid_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  status public.bid_status not null default 'pre_bid',
  due_on date,
  walk_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bid_sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  package_id uuid not null references public.bid_packages(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  measured_sqft numeric check (measured_sqft is null or measured_sqft >= 0),
  unique (package_id, property_id)
);

create table if not exists public.bid_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  package_id uuid not null references public.bid_packages(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  unit text not null default 'each' check (length(btrim(unit)) between 1 and 40),
  unit_price numeric not null default 0 check (unit_price >= 0),
  qty numeric not null default 1 check (qty >= 0),
  frequency public.bid_frequency not null default 'once',
  sort integer not null default 0
);

create table if not exists public.site_walk_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  package_id uuid not null references public.bid_packages(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  lat double precision,
  lng double precision,
  photo_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.takeoff_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  package_id uuid not null references public.bid_packages(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  filename text not null check (length(btrim(filename)) between 1 and 200),
  kind text not null check (kind in ('geojson', 'xls')),
  feature_count integer not null default 0 check (feature_count >= 0),
  area_sqft numeric check (area_sqft is null or area_sqft >= 0),
  created_at timestamptz not null default now()
);

create index if not exists bid_packages_org_status_idx on public.bid_packages (org_id, status, due_on);
create index if not exists bid_sites_package_idx on public.bid_sites (package_id);
create index if not exists bid_lines_package_idx on public.bid_lines (package_id, sort);
create index if not exists site_walk_notes_package_idx on public.site_walk_notes (package_id, created_at desc);

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
    if new.property_id is not null and not exists (
      select 1 from public.properties r where r.id = new.property_id and r.org_id = new.org_id
    ) then
      raise exception 'property must belong to the same org' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.bids_same_org() from public, anon;
grant execute on function private.bids_same_org() to authenticated, service_role;

drop trigger if exists bid_packages_same_org on public.bid_packages;
create trigger bid_packages_same_org before insert or update on public.bid_packages
  for each row execute function private.bids_same_org();
drop trigger if exists bid_sites_same_org on public.bid_sites;
create trigger bid_sites_same_org before insert or update on public.bid_sites
  for each row execute function private.bids_same_org();
drop trigger if exists bid_lines_same_org on public.bid_lines;
create trigger bid_lines_same_org before insert or update on public.bid_lines
  for each row execute function private.bids_same_org();
drop trigger if exists site_walk_notes_same_org on public.site_walk_notes;
create trigger site_walk_notes_same_org before insert or update on public.site_walk_notes
  for each row execute function private.bids_same_org();
drop trigger if exists takeoff_imports_same_org on public.takeoff_imports;
create trigger takeoff_imports_same_org before insert or update on public.takeoff_imports
  for each row execute function private.bids_same_org();

drop trigger if exists bid_packages_set_updated_at on public.bid_packages;
create trigger bid_packages_set_updated_at before update on public.bid_packages
  for each row execute function private.set_updated_at();

alter table public.bid_packages enable row level security;
alter table public.bid_packages force row level security;
alter table public.bid_sites enable row level security;
alter table public.bid_sites force row level security;
alter table public.bid_lines enable row level security;
alter table public.bid_lines force row level security;
alter table public.site_walk_notes enable row level security;
alter table public.site_walk_notes force row level security;
alter table public.takeoff_imports enable row level security;
alter table public.takeoff_imports force row level security;

create policy bid_packages_select on public.bid_packages for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy bid_packages_write on public.bid_packages for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy bid_sites_select on public.bid_sites for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy bid_sites_write on public.bid_sites for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy bid_lines_select on public.bid_lines for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy bid_lines_write on public.bid_lines for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy site_walk_notes_select on public.site_walk_notes for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy site_walk_notes_insert on public.site_walk_notes for insert to authenticated
  with check ((select private.is_org_member(org_id)));
create policy site_walk_notes_update on public.site_walk_notes for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy site_walk_notes_delete on public.site_walk_notes for delete to authenticated
  using ((select private.can_edit_customers(org_id)));

create policy takeoff_imports_select on public.takeoff_imports for select to authenticated
  using ((select private.can_read_office_records(org_id)));
create policy takeoff_imports_write on public.takeoff_imports for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
