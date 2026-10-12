-- Chemical application logs from the crew phone.
-- Office can read. The crew on the stop can write. No updates.

create table if not exists public.chemical_applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  product text not null,
  rate text not null,
  epa_reg_no text not null,
  temp_f numeric not null,
  wind_mph numeric not null,
  conditions text,
  applied_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chemical_applications_product_len check (length(btrim(product)) between 1 and 120),
  constraint chemical_applications_rate_len check (length(btrim(rate)) between 1 and 40),
  constraint chemical_applications_epa_len check (length(btrim(epa_reg_no)) between 1 and 40),
  constraint chemical_applications_conditions_len check (conditions is null or length(btrim(conditions)) between 1 and 80),
  constraint chemical_applications_temp_range check (temp_f between -40 and 130),
  constraint chemical_applications_wind_range check (wind_mph between 0 and 100)
);

create index if not exists chemical_applications_org_id_idx on public.chemical_applications (org_id);
create index if not exists chemical_applications_visit_id_idx on public.chemical_applications (visit_id);

alter table public.chemical_applications enable row level security;
alter table public.chemical_applications force row level security;

drop policy if exists chemical_applications_select on public.chemical_applications;
create policy chemical_applications_select on public.chemical_applications
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );

drop policy if exists chemical_applications_insert on public.chemical_applications;
create policy chemical_applications_insert on public.chemical_applications
  for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and (
      (select private.can_dispatch(org_id))
      or private.crew_can_read_visit(org_id, visit_id)
    )
  );

revoke all on table public.chemical_applications from public, anon, authenticated;
grant select, insert on table public.chemical_applications to authenticated;
grant all on table public.chemical_applications to service_role;
