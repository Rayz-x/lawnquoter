-- A snowfall at or above the trigger schedules one visit per snow agreement.

create table if not exists public.snow_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_date date not null,
  inches numeric not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint snow_events_inches_check check (inches >= 0 and inches <= 48)
);

create index if not exists snow_events_org_date_idx on public.snow_events (org_id, event_date);

alter table public.snow_events enable row level security;
alter table public.snow_events force row level security;

drop policy if exists snow_events_select on public.snow_events;
create policy snow_events_select on public.snow_events
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

revoke all on table public.snow_events from public, anon, authenticated;
grant select on table public.snow_events to authenticated;
grant all on table public.snow_events to service_role;

create or replace function public.activate_snow_event(p_event_date date, p_inches numeric)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_agreement public.agreements;
  v_job uuid;
  v_created integer := 0;
begin
  if v_org is null or not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_event_date is null then
    raise exception 'event date is required' using errcode = '22023';
  end if;
  if p_inches is null or p_inches < 0 or p_inches > 48 then
    raise exception 'Inches have to be between 0 and 48' using errcode = '22023';
  end if;

  insert into public.snow_events (org_id, event_date, inches, created_by)
  values (v_org, p_event_date, p_inches, auth.uid());

  for v_agreement in
    select a.*
    from public.agreements a
    where a.org_id = v_org
      and a.status = 'active'::public.agreement_status
      and a.service_kind = 'snow'
      and a.trigger_depth_in is not null
      and p_inches >= a.trigger_depth_in
    order by a.id
  loop
    if exists (
      select 1
      from public.visits v
      where v.org_id = v_org
        and v.agreement_id = v_agreement.id
        and v.occurrence_date = p_event_date
    ) then
      continue;
    end if;

    select j.id into v_job
    from public.jobs j
    where j.agreement_id = v_agreement.id
    order by j.created_at
    limit 1;
    if v_job is null then
      insert into public.jobs (org_id, agreement_id, property_id, title)
      values (v_org, v_agreement.id, v_agreement.property_id, 'Snow')
      returning id into v_job;
    end if;

    insert into public.visits (
      org_id, job_id, property_id, agreement_id, sort, occurrence_date, scheduled_date, status
    ) values (
      v_org, v_job, v_agreement.property_id, v_agreement.id, 0, p_event_date, p_event_date, 'scheduled'::public.visit_status
    );
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.activate_snow_event(date, numeric) from public, anon;
grant execute on function public.activate_snow_event(date, numeric) to authenticated, service_role;
