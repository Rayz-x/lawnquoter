-- Daily counters for imagery opens and saved measurements.
-- Members record through record_usage. Only owners and admins can read the rows.

create table public.usage_meters (
  org_id uuid not null references public.orgs(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('imagery_session', 'measurement')),
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  primary key (org_id, day, kind)
);

alter table public.usage_meters enable row level security;
alter table public.usage_meters force row level security;

create policy usage_meters_select on public.usage_meters
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

revoke all on public.usage_meters from public, anon, authenticated;
grant select on public.usage_meters to authenticated;
grant all on public.usage_meters to service_role;

create or replace function public.record_usage(p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_day date;
begin
  if auth.uid() is null or v_org is null or not private.is_org_member(v_org) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_kind not in ('imagery_session', 'measurement') then
    raise exception 'unknown usage kind' using errcode = '22023';
  end if;

  select (now() at time zone coalesce(o.timezone, 'America/Chicago'))::date
    into v_day
  from public.orgs o
  where o.id = v_org;

  insert into public.usage_meters (org_id, day, kind, count)
  values (v_org, v_day, p_kind, 1)
  on conflict (org_id, day, kind) do update
    set count = public.usage_meters.count + case when excluded.kind = 'imagery_session' then 0 else 1 end;
end;
$$;

revoke all on function public.record_usage(text) from public, anon;
grant execute on function public.record_usage(text) to authenticated, service_role;

create or replace function public.usage_totals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
begin
  if auth.uid() is null or v_org is null or not private.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'imagery_sessions', coalesce((
      select sum(m.count) from public.usage_meters m where m.org_id = v_org and m.kind = 'imagery_session'
    ), 0),
    'measurements', coalesce((
      select sum(m.count) from public.usage_meters m where m.org_id = v_org and m.kind = 'measurement'
    ), 0)
  );
end;
$$;

revoke all on function public.usage_totals() from public, anon;
grant execute on function public.usage_totals() to authenticated, service_role;
