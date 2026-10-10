-- S09: per-date lead for today and lead-at-time checks on crew_sync.
-- Office or a sub opens one active session for a crew+date. Previous lead
-- mutations still apply when occurred_at falls inside their session. An
-- in-progress visit and its open timer are left alone across a swap.
-- Dusty must OK applying this migration to hosted Supabase.

create table public.crew_lead_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete cascade,
  route_date date not null,
  lead_id uuid not null references public.profiles(id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index crew_lead_sessions_org_id_idx on public.crew_lead_sessions (org_id);
create index crew_lead_sessions_crew_date_idx
  on public.crew_lead_sessions (crew_id, route_date);
create unique index crew_lead_sessions_one_open
  on public.crew_lead_sessions (org_id, crew_id, route_date)
  where ended_at is null;

create trigger crew_lead_sessions_set_updated_at
  before update on public.crew_lead_sessions
  for each row execute function private.set_updated_at();

create trigger crew_lead_sessions_crew_org
  before insert or update of org_id, crew_id on public.crew_lead_sessions
  for each row execute function private.child_org_guard('crews', 'crew_id');

alter table public.crew_lead_sessions enable row level security;
alter table public.crew_lead_sessions force row level security;

create policy crew_lead_sessions_select on public.crew_lead_sessions
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or (select private.is_crew_member(org_id, crew_id))
  );

revoke all on table public.crew_lead_sessions from public, anon, authenticated;
grant select on table public.crew_lead_sessions to authenticated, service_role;

-- True when auth.uid() was the live crew lead at at_time for that route date.
-- Open sessions win. With no session covering that instant, default_lead_id
-- still counts so existing days without a session keep working.
create or replace function private.was_crew_lead_at(
  target_org uuid,
  target_crew uuid,
  route_date date,
  at_time timestamptz
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_org is not null
     and target_crew is not null
     and route_date is not null
     and target_org = private.current_org_id()
     and (
       exists (
         select 1
         from public.crew_lead_sessions s
         join public.memberships m
           on m.org_id = s.org_id
          and m.user_id = s.lead_id
         where s.org_id = target_org
           and s.crew_id = target_crew
           and s.route_date = route_date
           and s.lead_id = (select auth.uid())
           and s.started_at <= coalesce(at_time, pg_catalog.now())
           and (s.ended_at is null or s.ended_at > coalesce(at_time, pg_catalog.now()))
           and m.status = 'active'
           and m.role = 'crew_lead'::public.org_role
       )
       or (
         not exists (
           select 1
           from public.crew_lead_sessions s
           where s.org_id = target_org
             and s.crew_id = target_crew
             and s.route_date = route_date
             and s.started_at <= coalesce(at_time, pg_catalog.now())
             and (s.ended_at is null or s.ended_at > coalesce(at_time, pg_catalog.now()))
         )
         and exists (
           select 1
           from public.crews c
           join public.memberships m
             on m.org_id = c.org_id
            and m.user_id = c.default_lead_id
           where c.org_id = target_org
             and c.id = target_crew
             and c.default_lead_id = (select auth.uid())
             and m.status = 'active'
             and m.role = 'crew_lead'::public.org_role
         )
       )
     );
$$;

revoke all on function private.was_crew_lead_at(uuid, uuid, date, timestamptz) from public, anon;
grant execute on function private.was_crew_lead_at(uuid, uuid, date, timestamptz)
  to authenticated, service_role;

-- Day-pack / storage keep calling is_live_crew_lead. When crew_apply sets the
-- transaction GUCs, those values drive lead-at-time validation instead.
create or replace function private.is_live_crew_lead(target_org uuid, target_crew uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
  v_date date;
  v_at_text text;
  v_date_text text;
begin
  v_at_text := nullif(pg_catalog.current_setting('lawnquoter.lead_at', true), '');
  v_date_text := nullif(pg_catalog.current_setting('lawnquoter.lead_date', true), '');
  v_at := coalesce(v_at_text::timestamptz, pg_catalog.now());
  v_date := coalesce(
    v_date_text::date,
    private.org_local_today(target_org)
  );
  return private.was_crew_lead_at(target_org, target_crew, v_date, v_at);
end;
$$;

create or replace function private.open_lead_session(
  p_org uuid,
  p_crew_id uuid,
  p_date date,
  p_lead_id uuid,
  p_from_start_of_day boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_start timestamptz;
begin
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org
      and m.user_id = p_lead_id
      and m.status = 'active'
      and m.role = 'crew_lead'::public.org_role
  ) then
    raise exception 'lead must be an active crew lead' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.crew_members cm
    where cm.org_id = p_org
      and cm.crew_id = p_crew_id
      and cm.profile_id = p_lead_id
  ) then
    raise exception 'lead must be a member of this crew' using errcode = '23514';
  end if;

  update public.crew_lead_sessions
  set ended_at = pg_catalog.now()
  where org_id = p_org
    and crew_id = p_crew_id
    and route_date = p_date
    and ended_at is null;

  if p_from_start_of_day then
    select o.timezone into v_tz
    from public.orgs o
    where o.id = p_org;
    v_start := least(
      pg_catalog.now(),
      ((p_date::text || ' 00:00:00')::timestamp at time zone coalesce(v_tz, 'UTC'))
    );
  else
    v_start := pg_catalog.now();
  end if;

  insert into public.crew_lead_sessions (
    org_id, crew_id, route_date, lead_id, started_at
  ) values (
    p_org, p_crew_id, p_date, p_lead_id, v_start
  );
end;
$$;

revoke all on function private.open_lead_session(uuid, uuid, date, uuid, boolean)
  from public, anon, authenticated;

-- Office picks the lead for a crew date. Does not clear in-progress visits.
create or replace function public.set_lead_for_today(
  p_crew_id uuid,
  p_date date,
  p_lead_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select c.org_id into v_org
  from public.crews c
  where c.id = p_crew_id
  for update;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'a route date is required' using errcode = '22023';
  end if;

  perform private.open_lead_session(v_org, p_crew_id, p_date, p_lead_id, true);
end;
$$;

revoke all on function public.set_lead_for_today(uuid, date, uuid) from public, anon;
grant execute on function public.set_lead_for_today(uuid, date, uuid)
  to authenticated, service_role;

-- Sub signs in as lead for the date. Ends the previous open session.
create or replace function public.claim_lead_for_today(
  p_crew_id uuid,
  p_date date
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid := (select auth.uid());
begin
  select c.org_id into v_org
  from public.crews c
  where c.id = p_crew_id
  for update;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'a route date is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = v_org
      and m.user_id = v_uid
      and m.status = 'active'
      and m.role = 'crew_lead'::public.org_role
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Mid-day claim starts now so earlier actions stay on the previous session.
  perform private.open_lead_session(v_org, p_crew_id, p_date, v_uid, false);
end;
$$;

revoke all on function public.claim_lead_for_today(uuid, date) from public, anon;
grant execute on function public.claim_lead_for_today(uuid, date)
  to authenticated, service_role;

-- Wrapper sets lead-at-time GUCs, then runs the existing body.
alter function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  rename to crew_apply_impl;

create or replace function private.crew_apply(
  p_kind text,
  p_visit_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_device_now timestamptz,
  p_payload jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_crew uuid;
  v_route_date date;
  v_at timestamptz;
begin
  select v.org_id, r.crew_id, r.date
    into v_org, v_crew, v_route_date
  from public.visits v
  left join public.routes r
    on r.id = v.route_id
   and r.org_id = v.org_id
  where v.id = p_visit_id;

  v_at := least(coalesce(p_occurred_at, pg_catalog.now()), pg_catalog.now());
  if v_org is not null then
    perform set_config('lawnquoter.lead_at', v_at::text, true);
    perform set_config(
      'lawnquoter.lead_date',
      coalesce(v_route_date, private.org_local_today(v_org))::text,
      true
    );
  end if;

  return private.crew_apply_impl(
    p_kind, p_visit_id, p_client_id, p_occurred_at, p_device_now, p_payload
  );
end;
$$;

revoke all on function private.crew_apply_impl(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function private.crew_apply_impl(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  to service_role;
grant execute on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  to service_role;
