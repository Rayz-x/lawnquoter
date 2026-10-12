-- Snow contract on an agreement: per push, per inch, or seasonal, plus trigger depth.
-- Text, not a new enum, so the value can be stored in this migration.

alter table public.agreements
  add column if not exists snow_contract text;

alter table public.agreements
  add column if not exists trigger_depth_in numeric;

alter table public.agreements
  add column if not exists snow_price numeric;

alter table public.agreements
  add column if not exists snow_tiers jsonb;

do $$
begin
  alter table public.agreements
    add constraint agreements_snow_contract_known
    check (snow_contract is null or snow_contract in ('per_push', 'per_inch', 'seasonal_flat'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.agreements
    add constraint agreements_trigger_depth_nonnegative
    check (trigger_depth_in is null or trigger_depth_in >= 0);
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.agreements
    add constraint agreements_snow_price_nonnegative
    check (snow_price is null or snow_price >= 0);
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.agreements
    add constraint agreements_snow_tiers_array
    check (snow_tiers is null or jsonb_typeof(snow_tiers) = 'array');
exception
  when duplicate_object then null;
end
$$;

create or replace function public.set_agreement_snow_contract(
  p_agreement_id uuid,
  p_contract text,
  p_trigger_depth numeric,
  p_price numeric,
  p_tiers jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_contract is null or p_contract not in ('per_push', 'per_inch', 'seasonal_flat') then
    raise exception 'unknown snow contract' using errcode = '22023';
  end if;
  if p_trigger_depth is null or p_trigger_depth < 0 then
    raise exception 'trigger depth is required' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'snow price is required' using errcode = '22023';
  end if;
  if p_contract = 'per_inch' and (p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) < 1) then
    raise exception 'per-inch snow needs tiers' using errcode = '22023';
  end if;

  select a.org_id into v_org
  from public.agreements a
  where a.id = p_agreement_id
  for update;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.agreements
  set snow_contract = p_contract,
      trigger_depth_in = p_trigger_depth,
      snow_price = p_price,
      snow_tiers = case when p_contract = 'per_inch' then p_tiers else null end,
      service_kind = 'snow'
  where id = p_agreement_id;
end;
$$;

revoke all on function public.set_agreement_snow_contract(uuid, text, numeric, numeric, jsonb) from public, anon;
grant execute on function public.set_agreement_snow_contract(uuid, text, numeric, numeric, jsonb) to authenticated, service_role;
