-- Accounts (residential and commercial, hierarchical), contacts, properties
-- with parcel/footprint geometry, and a shared activity timeline.

create type public.account_type as enum ('residential', 'commercial');
create type public.account_status as enum ('lead', 'active', 'inactive');
create type public.contact_role as enum ('primary', 'billing', 'site', 'decision_maker', 'other');
create type public.slope_class as enum ('flat', 'gentle', 'moderate', 'steep');
create type public.geo_source as enum ('regrid', 'county', 'overture', 'osm', 'traced', 'manual', 'unknown');

-- ---------------------------------------------------------------------------
-- Role helpers for the common write policies
-- ---------------------------------------------------------------------------
create or replace function private.can_edit_customers(target_org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_org_role(target_org, array['owner','admin','sales','dispatcher']::public.org_role[]);
$$;
grant execute on function private.can_edit_customers(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  parent_account_id uuid references public.accounts(id) on delete set null,
  type public.account_type not null default 'residential',
  status public.account_status not null default 'lead',
  name text not null check (length(name) between 1 and 200),
  company_name text,
  email text,
  phone text,
  billing_email text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city text,
  billing_region text,
  billing_postal_code text,
  net_terms_days integer not null default 0 check (net_terms_days between 0 and 120),
  po_required boolean not null default false,
  tax_exempt boolean not null default false,
  tax_exempt_certificate text,
  consolidated_invoicing boolean not null default false,
  lead_source text,
  tags text[] not null default '{}',
  notes text,
  stripe_customer_id text,
  qbo_customer_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_account_id is distinct from id)
);

create index accounts_org_id_idx on public.accounts (org_id);
create index accounts_org_parent_idx on public.accounts (org_id, parent_account_id);
create index accounts_org_status_idx on public.accounts (org_id, status);
create index accounts_name_trgm_idx on public.accounts using gin (name extensions.gin_trgm_ops);
create index accounts_phone_idx on public.accounts (org_id, phone) where phone is not null;
create index accounts_email_idx on public.accounts (org_id, lower(email)) where email is not null;

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function private.set_updated_at();

-- Parent must belong to the same org.
create or replace function private.accounts_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_account_id is not null then
    if not exists (
      select 1 from public.accounts p
      where p.id = new.parent_account_id and p.org_id = new.org_id
    ) then
      raise exception 'parent account must belong to the same org' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger accounts_check_parent
  before insert or update of parent_account_id on public.accounts
  for each row execute function private.accounts_check_parent();

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  email text,
  phone text,
  sms_opt_in boolean not null default false,
  role public.contact_role not null default 'primary',
  is_primary boolean not null default false,
  is_billing boolean not null default false,
  title text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_org_account_idx on public.contacts (org_id, account_id);
create index contacts_phone_idx on public.contacts (org_id, phone) where phone is not null;
create index contacts_email_idx on public.contacts (org_id, lower(email)) where email is not null;
create unique index contacts_one_primary_per_account on public.contacts (account_id) where is_primary;

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Properties (service sites)
-- ---------------------------------------------------------------------------
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  region text not null,
  postal_code text not null,
  country text not null default 'US',
  formatted_address text,
  place_id text,
  location extensions.geography(Point, 4326),
  parcel extensions.geography(MultiPolygon, 4326),
  parcel_source public.geo_source not null default 'unknown',
  parcel_apn text,
  footprint extensions.geography(MultiPolygon, 4326),
  footprint_source public.geo_source not null default 'unknown',
  imagery_date date,
  lot_sqft numeric(12,1),
  building_sqft numeric(12,1),
  gate_width_in integer check (gate_width_in is null or gate_width_in between 0 and 240),
  slope public.slope_class,
  has_stairs boolean not null default false,
  has_dogs boolean not null default false,
  obstacle_count integer not null default 0 check (obstacle_count >= 0),
  access_notes text,
  crew_notes text,
  gate_code text,
  zone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index properties_org_account_idx on public.properties (org_id, account_id);
create index properties_org_postal_idx on public.properties (org_id, postal_code);
create index properties_location_gix on public.properties using gist (location);
create index properties_parcel_gix on public.properties using gist (parcel);
create index properties_address_trgm_idx on public.properties using gin (formatted_address extensions.gin_trgm_ops);

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function private.set_updated_at();

-- Account must belong to the same org; derive areas from geometry.
create or replace function private.properties_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts a where a.id = new.account_id and a.org_id = new.org_id) then
    raise exception 'account must belong to the same org' using errcode = '23503';
  end if;
  if new.parcel is not null then
    new.lot_sqft := round((extensions.st_area(new.parcel) * 10.7639104167)::numeric, 1);
  end if;
  if new.footprint is not null then
    new.building_sqft := round((extensions.st_area(new.footprint) * 10.7639104167)::numeric, 1);
  end if;
  if new.formatted_address is null then
    new.formatted_address := concat_ws(', ',
      concat_ws(' ', new.address_line1, new.address_line2),
      new.city,
      concat_ws(' ', new.region, new.postal_code)
    );
  end if;
  return new;
end;
$$;

create trigger properties_before_write
  before insert or update on public.properties
  for each row execute function private.properties_before_write();

-- ---------------------------------------------------------------------------
-- Activity timeline (shared by leads, quotes, jobs, invoices later)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  kind text not null,
  summary text not null,
  meta jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index activities_org_account_idx on public.activities (org_id, account_id, occurred_at desc);
create index activities_org_occurred_idx on public.activities (org_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Geometry RPCs (PostgREST cannot round-trip geography cleanly)
-- ---------------------------------------------------------------------------
create or replace function public.property_set_geometry(
  p_property uuid,
  p_location jsonb default null,
  p_parcel jsonb default null,
  p_parcel_source public.geo_source default null,
  p_parcel_apn text default null,
  p_footprint jsonb default null,
  p_footprint_source public.geo_source default null,
  p_imagery_date date default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.properties set
    location = case when p_location is null then location
                    else extensions.st_geomfromgeojson(p_location::text)::extensions.geography end,
    parcel = case when p_parcel is null then parcel
                  else extensions.st_multi(extensions.st_geomfromgeojson(p_parcel::text))::extensions.geography end,
    parcel_source = coalesce(p_parcel_source, parcel_source),
    parcel_apn = coalesce(p_parcel_apn, parcel_apn),
    footprint = case when p_footprint is null then footprint
                     else extensions.st_multi(extensions.st_geomfromgeojson(p_footprint::text))::extensions.geography end,
    footprint_source = coalesce(p_footprint_source, footprint_source),
    imagery_date = coalesce(p_imagery_date, imagery_date)
  where id = p_property;
  if not found then
    raise exception 'property not found' using errcode = 'P0002';
  end if;
end;
$$;
grant execute on function public.property_set_geometry(uuid, jsonb, jsonb, public.geo_source, text, jsonb, public.geo_source, date) to authenticated;

create or replace function public.property_geometry(p_property uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'location', extensions.st_asgeojson(p.location)::jsonb,
    'parcel', extensions.st_asgeojson(p.parcel)::jsonb,
    'footprint', extensions.st_asgeojson(p.footprint)::jsonb,
    'lot_sqft', p.lot_sqft,
    'building_sqft', p.building_sqft
  )
  from public.properties p
  where p.id = p_property;
$$;
grant execute on function public.property_geometry(uuid) to authenticated;

-- Nearby properties for neighborhood price memory / route density.
create or replace function public.properties_near(p_property uuid, p_radius_m numeric default 800)
returns table (id uuid, account_id uuid, formatted_address text, distance_m numeric, lot_sqft numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id, o.account_id, o.formatted_address,
         round(extensions.st_distance(o.location, p.location)::numeric, 0) as distance_m,
         o.lot_sqft
  from public.properties p
  join public.properties o
    on o.org_id = p.org_id
   and o.id <> p.id
   and extensions.st_dwithin(o.location, p.location, p_radius_m)
  where p.id = p_property
  order by distance_m
  limit 50;
$$;
grant execute on function public.properties_near(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.accounts enable row level security;
alter table public.accounts force row level security;
alter table public.contacts enable row level security;
alter table public.contacts force row level security;
alter table public.properties enable row level security;
alter table public.properties force row level security;
alter table public.activities enable row level security;
alter table public.activities force row level security;

create policy accounts_select on public.accounts for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy accounts_insert on public.accounts for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy accounts_update on public.accounts for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy accounts_delete on public.accounts for delete to authenticated
  using ((select private.is_org_admin(org_id)));

create policy contacts_select on public.contacts for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy contacts_insert on public.contacts for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy contacts_update on public.contacts for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy contacts_delete on public.contacts for delete to authenticated
  using ((select private.can_edit_customers(org_id)));

create policy properties_select on public.properties for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy properties_insert on public.properties for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy properties_update on public.properties for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy properties_delete on public.properties for delete to authenticated
  using ((select private.is_org_admin(org_id)));

create policy activities_select on public.activities for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy activities_insert on public.activities for insert to authenticated
  with check ((select private.is_org_member(org_id)));

grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.properties to authenticated;
grant select, insert on public.activities to authenticated;
grant all on public.accounts, public.contacts, public.properties, public.activities to service_role;
