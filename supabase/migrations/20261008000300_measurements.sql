-- Measurements and traced/auto/manual features per property.
-- Geometry lives in geography columns and is read/written via RPCs.

create type public.measurement_status as enum ('draft', 'current', 'archived');
create type public.feature_category as enum (
  'turf_front', 'turf_back', 'bed', 'hardscape', 'driveway', 'sidewalk',
  'edging_line', 'fence_line', 'canopy', 'roof'
);
create type public.feature_source as enum ('auto', 'traced', 'manual', 'imported');

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  status public.measurement_status not null default 'draft',
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  confidence_reasons text[] not null default '{}',
  imagery_date date,
  imagery_source text not null default 'esri_world_imagery',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index measurements_org_property_idx on public.measurements (org_id, property_id);
create unique index measurements_one_current on public.measurements (property_id) where status = 'current';

create trigger measurements_set_updated_at
  before update on public.measurements
  for each row execute function private.set_updated_at();

create table public.measurement_features (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  measurement_id uuid not null references public.measurements(id) on delete cascade,
  category public.feature_category not null,
  source public.feature_source not null default 'traced',
  geom extensions.geography(Geometry, 4326),
  area_sqft numeric,
  length_ft numeric,
  label text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index measurement_features_measurement_idx on public.measurement_features (measurement_id);
create index measurement_features_org_idx on public.measurement_features (org_id);
create index measurement_features_geom_idx on public.measurement_features using gist (geom);

create trigger measurement_features_set_updated_at
  before update on public.measurement_features
  for each row execute function private.set_updated_at();

-- Derive area/length from geography when a geometry is present. Manual
-- features without geometry keep the operator-entered numbers.
create or replace function private.measurement_features_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  gtype text;
begin
  if new.geom is not null then
    gtype := extensions.st_geometrytype(new.geom::extensions.geometry);
    if gtype in ('ST_Polygon', 'ST_MultiPolygon') then
      new.area_sqft := round((extensions.st_area(new.geom) * 10.7639104167)::numeric, 1);
      new.length_ft := round((extensions.st_perimeter(new.geom) * 3.28083989501)::numeric, 1);
    else
      new.length_ft := round((extensions.st_length(new.geom) * 3.28083989501)::numeric, 1);
      new.area_sqft := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger measurement_features_before_write
  before insert or update of geom on public.measurement_features
  for each row execute function private.measurement_features_before_write();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.measurement_ensure(p_property uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
begin
  select id into v_id
  from public.measurements
  where property_id = p_property and status in ('current', 'draft')
  order by case status when 'current' then 0 else 1 end, created_at desc
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select org_id into v_org from public.properties where id = p_property;
  if v_org is null then
    raise exception 'property not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed to create measurements' using errcode = '42501';
  end if;

  insert into public.measurements (org_id, property_id, status, created_by)
  values (v_org, p_property, 'draft', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.measurement_ensure(uuid) to authenticated;

create or replace function public.measurement_features_geojson(p_measurement uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'category', f.category,
    'source', f.source,
    'geometry', case when f.geom is null then null else extensions.st_asgeojson(f.geom)::jsonb end,
    'area_sqft', f.area_sqft,
    'length_ft', f.length_ft,
    'label', f.label,
    'notes', f.notes
  ) order by f.created_at), '[]'::jsonb)
  from public.measurement_features f
  where f.measurement_id = p_measurement;
$$;
grant execute on function public.measurement_features_geojson(uuid) to authenticated;

-- Replace every feature on a measurement. Used by the studio save action.
create or replace function public.measurement_replace_features(p_measurement uuid, p_features jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  rec jsonb;
begin
  select org_id into v_org from public.measurements where id = p_measurement;
  if v_org is null then
    raise exception 'measurement not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed to edit measurements' using errcode = '42501';
  end if;

  delete from public.measurement_features where measurement_id = p_measurement;

  for rec in select value from jsonb_array_elements(coalesce(p_features, '[]'::jsonb))
  loop
    insert into public.measurement_features (
      org_id, measurement_id, category, source, geom, area_sqft, length_ft, label, notes
    ) values (
      v_org,
      p_measurement,
      (rec ->> 'category')::public.feature_category,
      coalesce((rec ->> 'source')::public.feature_source, 'traced'),
      case
        when rec -> 'geometry' is null or rec -> 'geometry' = 'null'::jsonb then null
        else extensions.st_geomfromgeojson((rec -> 'geometry')::text)::extensions.geography
      end,
      nullif(rec ->> 'area_sqft', '')::numeric,
      nullif(rec ->> 'length_ft', '')::numeric,
      rec ->> 'label',
      rec ->> 'notes'
    );
  end loop;
end;
$$;
grant execute on function public.measurement_replace_features(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.measurements enable row level security;
alter table public.measurements force row level security;
alter table public.measurement_features enable row level security;
alter table public.measurement_features force row level security;

create policy measurements_select on public.measurements for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy measurements_insert on public.measurements for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy measurements_update on public.measurements for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy measurements_delete on public.measurements for delete to authenticated
  using ((select private.is_org_admin(org_id)));

create policy measurement_features_select on public.measurement_features for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy measurement_features_insert on public.measurement_features for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy measurement_features_update on public.measurement_features for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy measurement_features_delete on public.measurement_features for delete to authenticated
  using ((select private.can_edit_customers(org_id)));

grant select, insert, update, delete on public.measurements to authenticated;
grant select, insert, update, delete on public.measurement_features to authenticated;
grant all on public.measurements, public.measurement_features to service_role;
