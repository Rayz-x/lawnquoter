-- S07: day pack versioning + phone sync status for the office board.
-- routes.revision already bumps on published route changes and is returned
-- on crew_day_pack.route.revision. This table records which pack version
-- each phone last acknowledged.
--
-- Dusty: merging applies this to the hosted database. Do not apply from CI.

create table public.crew_phone_sync (
  org_id uuid not null references public.orgs (id) on delete cascade,
  crew_id uuid not null references public.crews (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  route_date date not null,
  pack_version integer not null default 0,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, profile_id, route_date),
  constraint crew_phone_sync_pack_version_nonneg check (pack_version >= 0)
);

create index crew_phone_sync_org_crew_date_idx
  on public.crew_phone_sync (org_id, crew_id, route_date);

create index crew_phone_sync_org_last_synced_idx
  on public.crew_phone_sync (org_id, last_synced_at);

alter table public.crew_phone_sync enable row level security;
alter table public.crew_phone_sync force row level security;

-- Office reads sync status. Field roles do not select via PostgREST;
-- writes go through the security definer ack RPC only.
create policy crew_phone_sync_select on public.crew_phone_sync
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

revoke all on table public.crew_phone_sync from public, anon;
grant select on table public.crew_phone_sync to authenticated, service_role;

-- Crew phone reports the pack version it just downloaded.
create or replace function public.crew_ack_day_pack(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_crew uuid;
  v_uid uuid;
  v_version integer;
  v_synced timestamptz;
begin
  v_org := private.current_org_id();
  v_uid := (select auth.uid());
  if v_org is null or v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = v_org
      and m.user_id = v_uid
      and m.status = 'active'
      and m.role in ('crew'::public.org_role, 'crew_lead'::public.org_role)
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select cm.crew_id into v_crew
  from public.crew_members cm
  join public.crews c
    on c.id = cm.crew_id
   and c.org_id = cm.org_id
  where cm.org_id = v_org
    and cm.profile_id = v_uid
  order by (c.default_lead_id = v_uid) desc nulls last, c.id
  limit 1;

  if v_crew is null or not private.is_crew_member(v_org, v_crew) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_date is null then
    raise exception 'date is required' using errcode = '22023';
  end if;

  select coalesce(r.revision, 0) into v_version
  from public.routes r
  where r.org_id = v_org
    and r.crew_id = v_crew
    and r.date = p_date
    and r.status <> 'draft'::public.route_status;

  v_version := coalesce(v_version, 0);
  v_synced := pg_catalog.now();

  insert into public.crew_phone_sync as s (
    org_id, crew_id, profile_id, route_date, pack_version, last_synced_at
  ) values (
    v_org, v_crew, v_uid, p_date, v_version, v_synced
  )
  on conflict (org_id, profile_id, route_date) do update
    set crew_id = excluded.crew_id,
        pack_version = excluded.pack_version,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.last_synced_at;

  return jsonb_build_object(
    'version', v_version,
    'last_synced_at', v_synced
  );
end;
$$;

revoke all on function public.crew_ack_day_pack(date) from public, anon;
grant execute on function public.crew_ack_day_pack(date) to authenticated, service_role;
