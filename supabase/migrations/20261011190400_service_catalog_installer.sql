-- Service catalog v1 (specs/service-catalog-v1.md): installer + price list activation.
-- Additive only. Catalog services land in a DRAFT price list; "Price from catalog"
-- only reads the active list, so nothing quotes until an admin activates it.

alter table public.services
  add column if not exists catalog_key text,
  add column if not exists catalog_version text,
  add column if not exists crew_task_name text,
  add column if not exists taxable boolean not null default false,
  add column if not exists is_material boolean not null default false;

create unique index if not exists services_org_catalog_key
  on public.services (org_id, catalog_key)
  where catalog_key is not null;

alter table public.pricing_rules
  add column if not exists starter_price boolean not null default false;

-- First edit to a starter rule's config clears the flag (owner has reviewed it).
create or replace function private.pricing_rules_clear_starter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.starter_price
     and new.starter_price
     and new.config is distinct from old.config then
    new.starter_price := false;
  end if;
  return new;
end;
$$;

drop trigger if exists pricing_rules_clear_starter on public.pricing_rules;
create trigger pricing_rules_clear_starter
  before update of config on public.pricing_rules
  for each row execute function private.pricing_rules_clear_starter();

-- Draft list for catalog installs: the newest draft, or a new one seeded with
-- the active list's modifiers.
create or replace function private.catalog_draft_price_list(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.price_lists
  where org_id = p_org and status = 'draft'
  order by created_at desc
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.price_lists (org_id, name, version, status, modifiers)
  select
    p_org,
    'Catalog draft',
    coalesce((select max(version) from public.price_lists where org_id = p_org), 0) + 1,
    'draft',
    coalesce((select modifiers from public.price_lists where org_id = p_org and status = 'active'), '{}'::jsonb)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.catalog_draft_price_list(uuid) from public, anon, authenticated;
grant execute on function private.catalog_draft_price_list(uuid) to service_role;

-- Install catalog entries (already validated by the app against the engine schema).
-- Idempotent by catalog key. Never writes to the active price list.
create or replace function public.install_catalog_services(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_list uuid;
  v_entry jsonb;
  v_service uuid;
  v_slug text;
  v_installed integer := 0;
  v_skipped integer := 0;
begin
  if v_org is null or not private.is_org_admin(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'pick at least one service' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) > 60 then
    raise exception 'too many services' using errcode = '22023';
  end if;

  v_list := private.catalog_draft_price_list(v_org);

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    if coalesce(v_entry->>'key', '') !~ '^[a-z0-9-]{1,60}$' then
      raise exception 'invalid catalog key' using errcode = '22023';
    end if;

    if exists (
      select 1 from public.services
      where org_id = v_org and catalog_key = v_entry->>'key'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_slug := v_entry->>'key';
    if exists (select 1 from public.services where org_id = v_org and slug = v_slug) then
      v_slug := v_slug || '-catalog';
    end if;

    insert into public.services (
      org_id, name, slug, kind, description, active, sort,
      window_start, window_end, warn_date,
      catalog_key, catalog_version, crew_task_name, taxable, is_material
    ) values (
      v_org,
      v_entry->>'name',
      v_slug,
      (v_entry->>'kind')::public.service_kind,
      nullif(v_entry->>'description', ''),
      true,
      coalesce((v_entry->>'sort')::integer, 0),
      nullif(v_entry->>'window_start', '')::date,
      nullif(v_entry->>'window_end', '')::date,
      nullif(v_entry->>'warn_date', '')::date,
      v_entry->>'key',
      v_entry->>'version',
      nullif(v_entry->>'crew_task_name', ''),
      coalesce((v_entry->>'taxable')::boolean, false),
      coalesce((v_entry->>'is_material')::boolean, false)
    )
    returning id into v_service;

    insert into public.pricing_rules (
      org_id, price_list_id, service_id, name, rule_type, config, starter_price
    ) values (
      v_org,
      v_list,
      v_service,
      v_entry->>'name',
      (v_entry->'config'->>'type')::public.rule_type,
      v_entry->'config',
      true
    );
    v_installed := v_installed + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'price_list_id', v_list,
    'installed', v_installed,
    'skipped', v_skipped
  );
end;
$$;

revoke all on function public.install_catalog_services(jsonb) from public, anon;
grant execute on function public.install_catalog_services(jsonb) to authenticated, service_role;

-- Activate a draft: carry over active rules for services the draft does not
-- price, archive the old active list, then make the draft active.
create or replace function public.activate_price_list(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.price_lists;
  v_active uuid;
begin
  select * into v_list from public.price_lists where id = p_id;
  if not found or v_list.org_id is distinct from private.current_org_id() then
    raise exception 'price list not found' using errcode = 'P0002';
  end if;
  if not private.is_org_admin(v_list.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_list.status <> 'draft' then
    raise exception 'only a draft price list can be activated' using errcode = '22023';
  end if;

  select id into v_active
  from public.price_lists
  where org_id = v_list.org_id and status = 'active';

  if v_active is not null then
    insert into public.pricing_rules (
      org_id, price_list_id, service_id, name, rule_type, config, active, sort, starter_price
    )
    select r.org_id, p_id, r.service_id, r.name, r.rule_type, r.config, r.active, r.sort, r.starter_price
    from public.pricing_rules r
    where r.price_list_id = v_active
      and not exists (
        select 1 from public.pricing_rules d
        where d.price_list_id = p_id and d.service_id = r.service_id
      );

    update public.price_lists set status = 'archived' where id = v_active;
  end if;

  update public.price_lists
  set status = 'active', effective_from = coalesce(effective_from, current_date)
  where id = p_id;

  return jsonb_build_object('ok', true, 'price_list_id', p_id, 'archived_id', v_active);
end;
$$;

revoke all on function public.activate_price_list(uuid) from public, anon;
grant execute on function public.activate_price_list(uuid) to authenticated, service_role;
