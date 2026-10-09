-- Service catalog, versioned price lists, rules, and cost inputs.

create type public.service_kind as enum ('mowing', 'fert', 'cleanup', 'snow', 'irrigation', 'install', 'other');
create type public.rule_type as enum ('tier_matrix', 'assembly', 'catalog', 'program', 'snow', 'irrigation');
create type public.price_list_status as enum ('draft', 'active', 'archived');

create or replace function private.can_edit_pricing(target_org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_org_admin(target_org);
$$;
grant execute on function private.can_edit_pricing(uuid) to authenticated, service_role;

create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  kind public.service_kind not null default 'other',
  description text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create index services_org_idx on public.services (org_id, kind, active);
create trigger services_set_updated_at
  before update on public.services
  for each row execute function private.set_updated_at();

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  version integer not null default 1,
  status public.price_list_status not null default 'draft',
  modifiers jsonb not null default '{}'::jsonb,
  effective_from date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index price_lists_one_active on public.price_lists (org_id) where status = 'active';
create trigger price_lists_set_updated_at
  before update on public.price_lists
  for each row execute function private.set_updated_at();

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  rule_type public.rule_type not null,
  config jsonb not null,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pricing_rules_list_idx on public.pricing_rules (price_list_id, service_id);
create trigger pricing_rules_set_updated_at
  before update on public.pricing_rules
  for each row execute function private.set_updated_at();

create table public.labor_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  hourly_rate numeric not null check (hourly_rate >= 0),
  burden_pct numeric not null default 0 check (burden_pct >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.equipment_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  hourly_rate numeric not null check (hourly_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  sku text,
  name text not null,
  unit text not null default 'each',
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  vendor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index materials_org_name_idx on public.materials (org_id, name);

create trigger labor_rates_set_updated_at
  before update on public.labor_rates
  for each row execute function private.set_updated_at();
create trigger equipment_rates_set_updated_at
  before update on public.equipment_rates
  for each row execute function private.set_updated_at();
create trigger materials_set_updated_at
  before update on public.materials
  for each row execute function private.set_updated_at();

-- Seed an active price list when an org is created.
create or replace function private.ensure_default_price_list()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.price_lists (org_id, name, version, status)
  values (new.id, 'Standard', 1, 'active');
  return new;
end;
$$;

create trigger orgs_default_price_list
  after insert on public.orgs
  for each row execute function private.ensure_default_price_list();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.services force row level security;
alter table public.price_lists enable row level security;
alter table public.price_lists force row level security;
alter table public.pricing_rules enable row level security;
alter table public.pricing_rules force row level security;
alter table public.labor_rates enable row level security;
alter table public.labor_rates force row level security;
alter table public.equipment_rates enable row level security;
alter table public.equipment_rates force row level security;
alter table public.materials enable row level security;
alter table public.materials force row level security;

create policy services_select on public.services for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy services_write on public.services for insert to authenticated
  with check ((select private.can_edit_pricing(org_id)));
create policy services_update on public.services for update to authenticated
  using ((select private.can_edit_pricing(org_id)))
  with check ((select private.can_edit_pricing(org_id)));
create policy services_delete on public.services for delete to authenticated
  using ((select private.can_edit_pricing(org_id)));

create policy price_lists_select on public.price_lists for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy price_lists_insert on public.price_lists for insert to authenticated
  with check ((select private.can_edit_pricing(org_id)));
create policy price_lists_update on public.price_lists for update to authenticated
  using ((select private.can_edit_pricing(org_id)))
  with check ((select private.can_edit_pricing(org_id)));
create policy price_lists_delete on public.price_lists for delete to authenticated
  using ((select private.can_edit_pricing(org_id)));

create policy pricing_rules_select on public.pricing_rules for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy pricing_rules_insert on public.pricing_rules for insert to authenticated
  with check ((select private.can_edit_pricing(org_id)));
create policy pricing_rules_update on public.pricing_rules for update to authenticated
  using ((select private.can_edit_pricing(org_id)))
  with check ((select private.can_edit_pricing(org_id)));
create policy pricing_rules_delete on public.pricing_rules for delete to authenticated
  using ((select private.can_edit_pricing(org_id)));

create policy labor_rates_select on public.labor_rates for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy labor_rates_write on public.labor_rates for all to authenticated
  using ((select private.can_edit_pricing(org_id)))
  with check ((select private.can_edit_pricing(org_id)));

create policy equipment_rates_select on public.equipment_rates for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy equipment_rates_write on public.equipment_rates for all to authenticated
  using ((select private.can_edit_pricing(org_id)))
  with check ((select private.can_edit_pricing(org_id)));

create policy materials_select on public.materials for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy materials_write on public.materials for all to authenticated
  using ((select private.can_edit_pricing(org_id)))
  with check ((select private.can_edit_pricing(org_id)));

grant select, insert, update, delete on public.services, public.price_lists, public.pricing_rules,
  public.labor_rates, public.equipment_rates, public.materials to authenticated;
grant all on public.services, public.price_lists, public.pricing_rules,
  public.labor_rates, public.equipment_rates, public.materials to service_role;
