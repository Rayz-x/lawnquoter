-- Weather rules decide whether a day is skipped or pushed.
-- A locked route day, when that column exists, moves one week later.

create table if not exists public.weather_skip_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  condition text not null,
  threshold numeric not null,
  action text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weather_skip_rules_condition_check check (condition in ('rain', 'snow', 'wind', 'freeze')),
  constraint weather_skip_rules_action_check check (action in ('skip', 'push')),
  constraint weather_skip_rules_threshold_check check (
    (condition = 'rain' and threshold between 0 and 20)
    or (condition = 'snow' and threshold between 0 and 48)
    or (condition = 'wind' and threshold between 0 and 100)
    or (condition = 'freeze' and threshold between -40 and 130)
  ),
  constraint weather_skip_rules_org_condition_key unique (org_id, condition)
);

create index if not exists weather_skip_rules_org_id_idx on public.weather_skip_rules (org_id);

drop trigger if exists weather_skip_rules_set_updated_at on public.weather_skip_rules;
create trigger weather_skip_rules_set_updated_at
  before update on public.weather_skip_rules
  for each row execute function private.set_updated_at();

alter table public.weather_skip_rules enable row level security;
alter table public.weather_skip_rules force row level security;

drop policy if exists weather_skip_rules_select on public.weather_skip_rules;
create policy weather_skip_rules_select on public.weather_skip_rules
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

revoke all on table public.weather_skip_rules from public, anon, authenticated;
grant select on table public.weather_skip_rules to authenticated;
grant all on table public.weather_skip_rules to service_role;

create or replace function public.set_weather_skip_rule(
  p_condition text,
  p_threshold numeric,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_id uuid;
begin
  if v_org is null or not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_condition not in ('rain', 'snow', 'wind', 'freeze') or p_action not in ('skip', 'push') then
    raise exception 'Pick rain, snow, wind, or freeze, and skip or push' using errcode = '22023';
  end if;
  if not (
    (p_condition = 'rain' and p_threshold between 0 and 20)
    or (p_condition = 'snow' and p_threshold between 0 and 48)
    or (p_condition = 'wind' and p_threshold between 0 and 100)
    or (p_condition = 'freeze' and p_threshold between -40 and 130)
  ) then
    raise exception 'That threshold is outside the range for this condition' using errcode = '22023';
  end if;

  insert into public.weather_skip_rules (org_id, condition, threshold, action)
  values (v_org, p_condition, p_threshold, p_action)
  on conflict (org_id, condition) do update
    set threshold = excluded.threshold,
        action = excluded.action,
        enabled = true
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.set_weather_skip_rule(text, numeric, text) from public, anon;
grant execute on function public.set_weather_skip_rule(text, numeric, text) to authenticated, service_role;

create or replace function public.office_apply_weather(
  p_service_date date,
  p_rain numeric,
  p_snow numeric,
  p_wind numeric,
  p_temp numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_action text;
  v_rule record;
  v_visit public.visits;
  v_crew uuid;
  v_move date;
  v_locked boolean;
  v_has_fixed boolean;
  v_affected integer := 0;
begin
  if v_org is null or not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_service_date is null then
    raise exception 'service date is required' using errcode = '22023';
  end if;

  v_has_fixed := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agreements'
      and column_name = 'fixed_route_day'
  );

  for v_rule in
    select condition, threshold, action
    from public.weather_skip_rules
    where org_id = v_org
      and enabled
    order by case condition
      when 'rain' then 1
      when 'snow' then 2
      when 'wind' then 3
      else 4
    end
  loop
    if v_rule.condition = 'rain' and p_rain >= v_rule.threshold then
      v_action := v_rule.action;
      exit;
    elsif v_rule.condition = 'snow' and p_snow >= v_rule.threshold then
      v_action := v_rule.action;
      exit;
    elsif v_rule.condition = 'wind' and p_wind >= v_rule.threshold then
      v_action := v_rule.action;
      exit;
    elsif v_rule.condition = 'freeze' and p_temp <= v_rule.threshold then
      v_action := v_rule.action;
      exit;
    end if;
  end loop;

  if v_action is null then
    return jsonb_build_object('action', null, 'affected', 0);
  end if;

  for v_visit in
    select v.*
    from public.visits v
    where v.org_id = v_org
      and v.scheduled_date = p_service_date
      and v.status = 'scheduled'::public.visit_status
    order by v.sort, v.id
    for update of v
  loop
    if v_action = 'skip' then
      update public.visits
      set status = 'skipped'::public.visit_status,
          skip_reason = 'weather'::public.visit_skip_reason
      where id = v_visit.id;
      v_affected := v_affected + 1;
      continue;
    end if;

    v_locked := false;
    if v_has_fixed and v_visit.agreement_id is not null then
      execute 'select coalesce(fixed_route_day, false) from public.agreements where id = $1'
        into v_locked
        using v_visit.agreement_id;
    end if;
    if v_locked then
      v_move := p_service_date + 7;
    else
      v_move := private.next_workday(v_org, p_service_date);
    end if;

    v_crew := null;
    if v_visit.route_id is not null then
      select r.crew_id into v_crew from public.routes r where r.id = v_visit.route_id;
    end if;
    if v_crew is not null then
      perform public.assign_visit(v_visit.id, v_crew, v_move, 0);
    else
      update public.visits
      set scheduled_date = v_move,
          route_id = null,
          sort = 0
      where id = v_visit.id;
    end if;
    v_affected := v_affected + 1;
  end loop;

  return jsonb_build_object('action', v_action, 'affected', v_affected);
end;
$$;

revoke all on function public.office_apply_weather(date, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.office_apply_weather(date, numeric, numeric, numeric, numeric) to authenticated, service_role;
