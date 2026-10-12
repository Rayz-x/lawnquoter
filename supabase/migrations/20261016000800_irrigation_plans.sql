-- Irrigation plans: zone count prices the visit and sets its duration.

alter table public.agreements
  add column if not exists zone_count integer;

alter table public.agreements
  add column if not exists minutes_per_zone integer;

alter table public.agreements
  add column if not exists price_per_zone numeric;

do $$
begin
  alter table public.agreements
    add constraint agreements_zone_count_positive
    check (zone_count is null or zone_count > 0);
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.agreements
    add constraint agreements_minutes_per_zone_positive
    check (minutes_per_zone is null or minutes_per_zone > 0);
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.agreements
    add constraint agreements_price_per_zone_nonnegative
    check (price_per_zone is null or price_per_zone >= 0);
exception
  when duplicate_object then null;
end
$$;

create or replace function private.visits_apply_irrigation_budget()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_minutes integer;
begin
  if new.agreement_id is null then
    return new;
  end if;

  select a.zone_count * a.minutes_per_zone
    into v_minutes
  from public.agreements a
  where a.id = new.agreement_id
    and a.service_kind = 'irrigation'
    and a.zone_count is not null
    and a.minutes_per_zone is not null;

  if v_minutes is not null then
    new.budget_minutes := v_minutes;
  end if;
  return new;
end;
$$;

drop trigger if exists visits_apply_irrigation_budget on public.visits;
create trigger visits_apply_irrigation_budget
  before insert on public.visits
  for each row execute function private.visits_apply_irrigation_budget();

create or replace function public.set_agreement_irrigation_plan(
  p_agreement_id uuid,
  p_zones integer,
  p_minutes_per_zone integer,
  p_price_per_zone numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_today date;
begin
  if p_zones is null or p_zones < 1 or p_minutes_per_zone is null or p_minutes_per_zone < 1 then
    raise exception 'zones and minutes are required' using errcode = '22023';
  end if;
  if p_price_per_zone is null or p_price_per_zone < 0 then
    raise exception 'price per zone is required' using errcode = '22023';
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
  set zone_count = p_zones,
      minutes_per_zone = p_minutes_per_zone,
      price_per_zone = p_price_per_zone,
      service_kind = 'irrigation'
  where id = p_agreement_id;

  select (timezone(o.timezone, now()))::date into v_today
  from public.orgs o
  where o.id = v_org;

  update public.visits
  set budget_minutes = p_zones * p_minutes_per_zone
  where agreement_id = p_agreement_id
    and org_id = v_org
    and status = 'scheduled'::public.visit_status
    and scheduled_date >= v_today;
end;
$$;

revoke all on function public.set_agreement_irrigation_plan(uuid, integer, integer, numeric) from public, anon;
grant execute on function public.set_agreement_irrigation_plan(uuid, integer, integer, numeric) to authenticated, service_role;
