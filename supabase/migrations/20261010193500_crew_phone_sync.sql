-- S07 phone sync / pack versioning (with folded S08 gate-code window body).
-- Merge order: #112 (Needs attention tray) → this PR (#107) → #113.
-- #113 rebases onto this tip; its later migration re-asserts the gate window
-- without dropping top-level pack version (routes.revision) or phone ack.
--
alter table public.crew_members
  drop constraint if exists crew_members_org_id_profile_id_key;

-- set_crew_lead used ON CONFLICT (org_id, profile_id) and rejected a second
-- crew. Point conflict at (crew_id, profile_id) so a lead can join another crew.
create or replace function public.set_crew_lead(p_crew_id uuid, p_profile_id uuid)
returns void
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
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = v_org
      and m.user_id = p_profile_id
      and m.status = 'active'
      and m.role = 'crew_lead'
  ) then
    raise exception 'lead must be an active crew lead' using errcode = '23514';
  end if;

  insert into public.crew_members (org_id, crew_id, profile_id)
  values (v_org, p_crew_id, p_profile_id)
  on conflict (crew_id, profile_id) do nothing;

  update public.crews
  set default_lead_id = p_profile_id
  where id = p_crew_id;
end;
$$;

revoke all on function public.set_crew_lead(uuid, uuid) from public, anon;
grant execute on function public.set_crew_lead(uuid, uuid) to authenticated, service_role;

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

-- Crew phone reports the pack version for the crew route it downloaded.
-- p_crew_id must be the crew from that pack (not membership order).
create or replace function public.crew_ack_day_pack(p_date date, p_crew_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
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

  if p_date is null or p_crew_id is null then
    raise exception 'date and crew are required' using errcode = '22023';
  end if;

  if not private.is_crew_member(v_org, p_crew_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select coalesce(r.revision, 0) into v_version
  from public.routes r
  where r.org_id = v_org
    and r.crew_id = p_crew_id
    and r.date = p_date
    and r.status <> 'draft'::public.route_status;

  v_version := coalesce(v_version, 0);
  v_synced := pg_catalog.now();

  insert into public.crew_phone_sync as s (
    org_id, crew_id, profile_id, route_date, pack_version, last_synced_at
  ) values (
    v_org, p_crew_id, v_uid, p_date, v_version, v_synced
  )
  on conflict (org_id, profile_id, route_date) do update
    set crew_id = excluded.crew_id,
        pack_version = excluded.pack_version,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.last_synced_at;

  return jsonb_build_object(
    'version', v_version,
    'crew_id', p_crew_id,
    'last_synced_at', v_synced
  );
end;
$$;

revoke all on function public.crew_ack_day_pack(date, uuid) from public, anon;
grant execute on function public.crew_ack_day_pack(date, uuid) to authenticated, service_role;

create or replace function private.crew_can_read_visit(target_org uuid, target_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.visits v
    where v.id = target_visit
      and v.org_id = target_org
      and v.status <> 'cancelled'::public.visit_status
      and (
        (
          v.scheduled_date between private.org_local_today(target_org) - 1
                               and private.org_local_today(target_org) + 1
          and private.crew_route_in_window(target_org, v.route_id)
        )
        or (
          v.status in (
            'in_progress'::public.visit_status,
            'paused'::public.visit_status
          )
          and v.scheduled_date < private.org_local_today(target_org) - 1
          and exists (
            select 1
            from public.routes r
            where r.id = v.route_id
              and r.org_id = v.org_id
              and r.status <> 'draft'::public.route_status
              and private.is_crew_member(target_org, r.crew_id)
          )
        )
      )
  );
$$;

revoke all on function private.crew_can_read_visit(uuid, uuid) from public, anon;
grant execute on function private.crew_can_read_visit(uuid, uuid) to authenticated, service_role;

-- True when this visit may carry gate_code / access_notes in a day pack.
-- Window is always org-local today ± 1 on the visit's own route date, never
-- the phone-supplied pack date. Overdue active stops stay pinned.
create or replace function private.crew_gate_code_visible(
  target_org uuid,
  visit_status public.visit_status,
  route_date date,
  scheduled_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select visit_status is distinct from 'cancelled'::public.visit_status
     and (
       (
         route_date is not null
         and route_date between private.org_local_today(target_org) - 1
                            and private.org_local_today(target_org) + 1
       )
       or (
         visit_status in (
           'in_progress'::public.visit_status,
           'paused'::public.visit_status
         )
         and scheduled_date < private.org_local_today(target_org) - 1
       )
     );
$$;

revoke all on function private.crew_gate_code_visible(
  uuid, public.visit_status, date, date
) from public, anon;
grant execute on function private.crew_gate_code_visible(
  uuid, public.visit_status, date, date
) to authenticated, service_role;

create or replace function public.crew_day_pack(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_crew uuid;
  v_today date;
  v_route public.routes;
begin
  v_org := private.current_org_id();
  if v_org is null or (select auth.uid()) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = v_org
      and m.user_id = (select auth.uid())
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
    and cm.profile_id = (select auth.uid())
  order by (c.default_lead_id = (select auth.uid())) desc nulls last, c.id
  limit 1;

  if v_crew is null or not private.is_crew_member(v_org, v_crew) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Org clock only. The phone date in p_date never moves this window.
  v_today := private.org_local_today(v_org);
  if p_date is null or p_date > v_today + 1 then
    raise exception 'that date is outside the crew window' using errcode = '22023';
  end if;
  if p_date < v_today - 1 and not exists (
    select 1
    from public.visits v
    join public.routes r
      on r.id = v.route_id
     and r.org_id = v.org_id
    where v.org_id = v_org
      and r.crew_id = v_crew
      and r.date = p_date
      and r.status <> 'draft'::public.route_status
      and v.status in ('in_progress'::public.visit_status, 'paused'::public.visit_status)
  ) then
    raise exception 'that date is outside the crew window' using errcode = '22023';
  end if;

  select * into v_route
  from public.routes r
  where r.org_id = v_org
    and r.crew_id = v_crew
    and r.date = p_date
    and r.status <> 'draft'::public.route_status;

  return jsonb_build_object(
    'date', p_date,
    'server_today', v_today,
    'version', coalesce(v_route.revision, 0),
    'is_live_lead', private.is_live_crew_lead(v_org, v_crew),
    'crew', (
      select jsonb_build_object('id', c.id, 'name', c.name)
      from public.crews c
      where c.id = v_crew
    ),
    'office', (
      select jsonb_build_object('name', o.name, 'phone', o.phone)
      from public.orgs o
      where o.id = v_org
    ),
    'route', case
      when v_route.id is null then null
      else jsonb_build_object(
        'id', v_route.id,
        'date', v_route.date,
        'status', v_route.status,
        'revision', v_route.revision
      )
    end,
    'visits', coalesce((
      select jsonb_agg(row_pack.visit order by row_pack.sort, row_pack.id)
      from (
        select
          v.sort,
          v.id,
          jsonb_build_object(
            'id', v.id,
            'sort', v.sort,
            'status', v.status,
            'scheduled_date', v.scheduled_date,
            'occurrence_date', v.occurrence_date,
            'window_start', v.window_start,
            'window_end', v.window_end,
            'started_at', v.started_at,
            'completed_at', v.completed_at,
            'crew_size', v.crew_size,
            'budget_minutes', v.budget_minutes,
            'skip_reason', v.skip_reason,
            'reopen_until', v.reopen_until,
            'completed_after_cancel', v.completed_after_cancel,
            'crew_note', v.crew_note,
            'title', j.title,
            'property', jsonb_build_object(
              'id', p.id,
              'address_line1', p.address_line1,
              'address_line2', p.address_line2,
              'city', p.city,
              'region', p.region,
              'postal_code', p.postal_code,
              'formatted_address', p.formatted_address,
              'last_name', (
                select nullif(btrim(ct.last_name), '')
                from public.contacts ct
                where ct.account_id = a.id
                  and ct.org_id = a.org_id
                  and ct.is_primary
                order by ct.created_at
                limit 1
              ),
              'lat', extensions.st_y(p.location::extensions.geometry),
              'lng', extensions.st_x(p.location::extensions.geometry),
              'gate_code', case
                when private.crew_gate_code_visible(
                  v_org, v.status, vr.date, v.scheduled_date
                ) then pa.gate_code
                else null
              end,
              'access_notes', case
                when private.crew_gate_code_visible(
                  v_org, v.status, vr.date, v.scheduled_date
                ) then pa.access_notes
                else null
              end,
              'gate_width_in', p.gate_width_in,
              'has_dogs', p.has_dogs,
              'has_stairs', p.has_stairs,
              'slope', p.slope,
              'crew_notes', p.crew_notes,
              'obstacle_count', p.obstacle_count
            ),
            'tasks', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', t.id,
                'label', t.label,
                'quantity_text', t.quantity_text,
                'notes_crew', t.notes_crew,
                'done_at', t.done_at,
                'not_done_reason', t.not_done_reason,
                'sort', t.sort
              ) order by t.sort, t.id)
              from public.visit_tasks t
              where t.visit_id = v.id
                and t.org_id = v.org_id
            ), '[]'::jsonb),
            'photos', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', ph.id,
                'kind', ph.kind,
                'storage_path', ph.storage_path,
                'taken_at', ph.taken_at,
                'client_id', ph.client_id
              ) order by ph.taken_at, ph.id)
              from public.visit_photos ph
              where ph.visit_id = v.id
                and ph.org_id = v.org_id
            ), '[]'::jsonb),
            'plan', coalesce((
              select jsonb_agg(jsonb_build_object(
                'category', f.category,
                'label', f.label,
                'area_sqft', f.area_sqft,
                'length_ft', f.length_ft,
                'geometry', extensions.st_asgeojson(
                  extensions.st_simplify(f.geom::extensions.geometry, 0.00002)
                )::jsonb
              ) order by f.created_at, f.id)
              from public.measurement_features f
              join public.measurements m
                on m.id = f.measurement_id
               and m.org_id = f.org_id
              where m.property_id = v.property_id
                and m.org_id = v.org_id
                and m.status = 'current'::public.measurement_status
                and f.geom is not null
            ), '[]'::jsonb)
          ) as visit
        from public.visits v
        join public.jobs j
          on j.id = v.job_id
         and j.org_id = v.org_id
        join public.properties p
          on p.id = v.property_id
         and p.org_id = v.org_id
        join public.accounts a
          on a.id = p.account_id
         and a.org_id = p.org_id
        left join public.routes vr
          on vr.id = v.route_id
         and vr.org_id = v.org_id
        left join public.property_access pa
          on pa.property_id = p.id
         and pa.org_id = p.org_id
        where v.org_id = v_org
          and (
            v.route_id = v_route.id
            or (
              p_date = v_today
              and v.status in ('in_progress'::public.visit_status, 'paused'::public.visit_status)
              and v.scheduled_date < v_today - 1
              and exists (
                select 1
                from public.routes r
                where r.id = v.route_id
                  and r.org_id = v.org_id
                  and r.crew_id = v_crew
                  and r.status <> 'draft'::public.route_status
              )
            )
          )
      ) as row_pack
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.crew_day_pack(date) from public, anon;
grant execute on function public.crew_day_pack(date) to authenticated, service_role;
