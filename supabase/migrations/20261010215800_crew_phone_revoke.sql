-- Restacked on main tip (photo_pending/photo_lost from #163).
-- S11: Office Revoke phone ends the crew session (HTTP 401 / SQLSTATE 28000),
-- snapshots started-but-unsynced visits, and packs still expire after 48h on device.

create table public.crew_phone_revocations (
  org_id uuid not null references public.orgs (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  revoked_at timestamptz not null default now(),
  revoked_by uuid references public.profiles (id) on delete set null,
  cleared_at timestamptz,
  unsynced_visits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, profile_id),
  constraint crew_phone_revocations_unsynced_is_array
    check (pg_catalog.jsonb_typeof(unsynced_visits) = 'array')
);

create index crew_phone_revocations_org_active_idx
  on public.crew_phone_revocations (org_id)
  where cleared_at is null;

create trigger crew_phone_revocations_set_updated_at
  before update on public.crew_phone_revocations
  for each row execute function private.set_updated_at();

alter table public.crew_phone_revocations enable row level security;
alter table public.crew_phone_revocations force row level security;

create policy crew_phone_revocations_select on public.crew_phone_revocations
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

revoke all on table public.crew_phone_revocations from public, anon;
grant select on table public.crew_phone_revocations to authenticated, service_role;

-- Active revoke blocks crew pack / sync. SQLSTATE 28000 → HTTP 401 in PostgREST.
create or replace function private.assert_crew_phone_session()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_uid uuid := (select auth.uid());
begin
  if v_org is null or v_uid is null then
    return;
  end if;
  if exists (
    select 1
    from public.crew_phone_revocations r
    where r.org_id = v_org
      and r.profile_id = v_uid
      and r.cleared_at is null
  ) then
    raise exception 'phone revoked' using errcode = '28000';
  end if;
end;
$$;

revoke all on function private.assert_crew_phone_session() from public, anon;
grant execute on function private.assert_crew_phone_session() to authenticated, service_role;

create or replace function private.started_unsynced_visits_for_profile(
  p_org uuid,
  p_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'title', coalesce(j.title, 'Visit'),
        'address', coalesce(
          nullif(btrim(p.formatted_address), ''),
          nullif(btrim(concat_ws(', ', p.address_line1, p.city)), '')
        ),
        'status', v.status::text,
        'scheduled_date', v.scheduled_date
      )
      order by v.scheduled_date nulls last, coalesce(j.title, 'Visit'), v.id
    ),
    '[]'::jsonb
  )
  from public.visits v
  join public.routes r
    on r.id = v.route_id
   and r.org_id = v.org_id
   and r.status <> 'draft'::public.route_status
  join public.crew_members cm
    on cm.crew_id = r.crew_id
   and cm.org_id = r.org_id
  left join public.jobs j
    on j.id = v.job_id
   and j.org_id = v.org_id
  left join public.properties p
    on p.id = v.property_id
   and p.org_id = v.org_id
  where cm.org_id = p_org
    and cm.profile_id = p_profile_id
    and v.status in (
      'in_progress'::public.visit_status,
      'paused'::public.visit_status
    );
$$;

revoke all on function private.started_unsynced_visits_for_profile(uuid, uuid)
  from public, anon;
grant execute on function private.started_unsynced_visits_for_profile(uuid, uuid)
  to authenticated, service_role;

create or replace function public.office_revoke_phone(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_uid uuid := (select auth.uid());
  v_at timestamptz := pg_catalog.now();
  v_visits jsonb;
begin
  if v_org is null or v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_profile_id is null then
    raise exception 'profile is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.org_id = v_org
      and m.user_id = p_profile_id
      and m.status = 'active'
      and m.role in ('crew'::public.org_role, 'crew_lead'::public.org_role)
  ) then
    raise exception 'crew phone not found' using errcode = 'P0002';
  end if;

  v_visits := private.started_unsynced_visits_for_profile(v_org, p_profile_id);

  insert into public.crew_phone_revocations as r (
    org_id, profile_id, revoked_at, revoked_by, cleared_at, unsynced_visits
  ) values (
    v_org, p_profile_id, v_at, v_uid, null, v_visits
  )
  on conflict (org_id, profile_id) do update
    set revoked_at = excluded.revoked_at,
        revoked_by = excluded.revoked_by,
        cleared_at = null,
        unsynced_visits = excluded.unsynced_visits,
        updated_at = excluded.revoked_at;

  return jsonb_build_object(
    'profile_id', p_profile_id,
    'revoked_at', v_at,
    'unsynced_visits', v_visits
  );
end;
$$;

revoke all on function public.office_revoke_phone(uuid) from public, anon;
grant execute on function public.office_revoke_phone(uuid) to authenticated, service_role;

create or replace function public.office_clear_phone_revoke(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
begin
  if v_org is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_profile_id is null then
    raise exception 'profile is required' using errcode = '22023';
  end if;

  update public.crew_phone_revocations
  set cleared_at = pg_catalog.now()
  where org_id = v_org
    and profile_id = p_profile_id
    and cleared_at is null;

  if not found then
    raise exception 'crew phone not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.office_clear_phone_revoke(uuid) from public, anon;
grant execute on function public.office_clear_phone_revoke(uuid) to authenticated, service_role;

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
  perform private.assert_crew_phone_session();

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

create or replace function public.crew_sync(p_mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_status text;
  v_message text;
  v_results jsonb := '[]'::jsonb;
  v_client uuid;
begin
  perform private.assert_crew_phone_session();

  if p_mutations is null or pg_catalog.jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'crew_sync expects a list of mutations' using errcode = '22023';
  end if;

  for v_item in
    select t.value
    from pg_catalog.jsonb_array_elements(p_mutations) with ordinality as t(value, ord)
    order by t.ord
  loop
    begin
      v_client := (v_item->>'client_id')::uuid;
      v_status := private.crew_apply(
        v_item->>'kind',
        (v_item->>'visit_id')::uuid,
        v_client,
        (v_item->>'occurred_at')::timestamptz,
        (v_item->>'device_now')::timestamptz,
        coalesce(v_item->'payload', '{}'::jsonb)
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'client_id', v_client,
        'status', v_status,
        'message', null
      ));
    exception
      when others then
        v_message := case
          when sqlstate in ('22023', '42501', 'P0002') then sqlerrm
          when sqlstate = '23514' and sqlerrm = 'visit photo file is missing' then sqlerrm
          else 'could not apply that change'
        end;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'client_id', v_item->>'client_id',
          'status', 'error',
          'message', v_message
        ));
        if v_message is distinct from 'enhancement photo must belong to this visit' then
          exit;
        end if;
    end;
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;

revoke all on function public.crew_sync(jsonb) from public, anon;
grant execute on function public.crew_sync(jsonb) to authenticated, service_role;

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
  perform private.assert_crew_phone_session();

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
            'photo_pending', v.photo_pending,
            'photo_lost', v.photo_lost,
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
