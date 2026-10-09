-- Crew capture RPCs (build step 11, part B).
--
-- Depends on 20261009200000_crew_capture_schema.sql. That file is unchanged.
--
-- The lead's phone calls crew_day_pack for one date and crew_sync for the
-- outbox. There are no one-at-a-time wrappers around crew_sync.
--
-- Dusty: start, pause, and finish re-check private.is_live_crew_lead. A
-- demoted lead fails, including a replay of a client_id they already sent.
-- Skip and the other writes use the same check.
--
-- client_id is claimed before the status change, so a replay is not a
-- transition error. The same client_id on a different visit or kind errors.
-- A client timestamp later than the server clock is clamped to server time.
-- A visit left in progress or paused can still be paused, resumed, finished,
-- or skipped, including one older than yesterday. Today's pack includes it.
-- A new visit can be started yesterday or today, not tomorrow.

-- ---------------------------------------------------------------------------
-- Crew note. Office notes stay on visit_office_notes. Authenticated has no
-- UPDATE grant on this column; the RPC writes it.
-- ---------------------------------------------------------------------------
alter table public.visits
  add column crew_note text;

alter table public.visits
  add constraint visits_crew_note_len check (
    crew_note is null or length(btrim(crew_note)) between 1 and 2000
  );

-- One row per org and client_id. The kind is stored so a reused id with a
-- different action fails instead of replaying the wrong mutation.
create table public.crew_mutation_receipts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  client_id uuid not null,
  kind text not null,
  visit_id uuid references public.visits(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, client_id)
);

create index crew_mutation_receipts_visit_id_idx
  on public.crew_mutation_receipts (visit_id);

alter table public.crew_mutation_receipts enable row level security;
alter table public.crew_mutation_receipts force row level security;

revoke all on table public.crew_mutation_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.crew_mutation_receipts to service_role;

-- ---------------------------------------------------------------------------
-- Shared apply. Returns 'applied' or 'replayed'.
-- ---------------------------------------------------------------------------
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
  v_visit public.visits;
  v_crew uuid;
  v_route_status public.route_status;
  v_claimed uuid;
  v_existing text;
  v_existing_visit uuid;
  v_at timestamptz;
  v_skew boolean;
  v_in_window boolean;
  v_active boolean;
  v_reason public.visit_skip_reason;
  v_size integer;
  v_note text;
  v_task uuid;
  v_done boolean;
  v_photo_kind public.visit_photo_kind;
  v_tag public.enhancement_tag;
  v_lat double precision;
  v_lng double precision;
  v_photo_ids uuid[];
  v_tz text;
  v_event public.visit_event_kind;
  v_entry public.time_entry_kind;
begin
  if p_client_id is null or p_visit_id is null or p_kind is null then
    raise exception 'a client_id, visit, and kind are required' using errcode = '22023';
  end if;
  if p_kind not in (
    'visit_start', 'visit_pause', 'visit_resume', 'visit_finish', 'visit_skip',
    'visit_reopen', 'visit_set_crew_size', 'visit_set_note', 'visit_task_set',
    'visit_photo_record', 'enhancement_create'
  ) then
    raise exception 'mutation kind is not valid' using errcode = '22023';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from private.current_org_id() then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;

  select r.crew_id, r.status
    into v_crew, v_route_status
  from public.routes r
  where r.id = v_visit.route_id
    and r.org_id = v_visit.org_id;

  -- Live membership, not the JWT role. A demoted lead fails here, before the
  -- receipt, so a replay does not succeed after the demotion.
  if v_crew is null or not private.is_live_crew_lead(v_visit.org_id, v_crew) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.crew_mutation_receipts (org_id, client_id, kind, visit_id)
  values (v_visit.org_id, p_client_id, p_kind, v_visit.id)
  on conflict (org_id, client_id) do nothing
  returning client_id into v_claimed;

  if v_claimed is null then
    select kind, visit_id into v_existing, v_existing_visit
    from public.crew_mutation_receipts
    where org_id = v_visit.org_id
      and client_id = p_client_id;
    if v_existing is distinct from p_kind or v_existing_visit is distinct from v_visit.id then
      raise exception 'client_id was already used' using errcode = '22023';
    end if;
    return 'replayed';
  end if;

  -- A phone clock set ahead must not write a future start, finish, or photo.
  v_at := least(coalesce(p_occurred_at, pg_catalog.now()), pg_catalog.now());
  v_skew := p_device_now is not null
    and abs(extract(epoch from (p_device_now - pg_catalog.now()))) > 300;
  v_active := v_visit.status in (
    'in_progress'::public.visit_status,
    'paused'::public.visit_status
  );
  v_in_window := v_route_status is distinct from 'draft'::public.route_status
    and v_visit.scheduled_date between private.org_local_today(v_visit.org_id) - 1
                                    and private.org_local_today(v_visit.org_id) + 1;

  if p_kind = 'visit_start' then
    if v_visit.status is distinct from 'scheduled'::public.visit_status
       or not v_in_window
       or v_visit.scheduled_date > private.org_local_today(v_visit.org_id) then
      raise exception 'that visit cannot be started' using errcode = '22023';
    end if;
    update public.visits
    set status = 'in_progress',
        started_at = coalesce(started_at, v_at)
    where id = v_visit.id;
    v_event := 'started';
    v_entry := 'job';
  elsif p_kind = 'visit_pause' then
    if v_visit.status is distinct from 'in_progress'::public.visit_status then
      raise exception 'that visit cannot be paused' using errcode = '22023';
    end if;
    update public.visits set status = 'paused' where id = v_visit.id;
    v_event := 'paused';
    v_entry := 'pause';
  elsif p_kind = 'visit_resume' then
    if v_visit.status is distinct from 'paused'::public.visit_status then
      raise exception 'that visit cannot be resumed' using errcode = '22023';
    end if;
    update public.visits set status = 'in_progress' where id = v_visit.id;
    v_event := 'resumed';
    v_entry := 'job';
  elsif p_kind = 'visit_finish' then
    -- In progress on a past day is still finishable. The schema only blocks
    -- a second active visit on the same scheduled date.
    if not v_active then
      raise exception 'that visit cannot be finished' using errcode = '22023';
    end if;
    select o.timezone into v_tz
    from public.orgs o
    where o.id = v_visit.org_id;
    update public.visits
    set status = 'completed',
        completed_at = v_at,
        reopen_until = (
          (private.org_local_today(v_visit.org_id)::text || ' 18:00:00')::timestamp
          at time zone v_tz
        )
    where id = v_visit.id;
    v_event := 'finished';
  elsif p_kind = 'visit_skip' then
    if v_active then
      null;
    elsif v_visit.status = 'scheduled'::public.visit_status and v_in_window then
      null;
    else
      raise exception 'that visit cannot be skipped' using errcode = '22023';
    end if;
    begin
      v_reason := (p_payload->>'reason')::public.visit_skip_reason;
    exception
      when invalid_text_representation then
        raise exception 'skip reason is not valid' using errcode = '22023';
    end;
    if v_reason is null then
      raise exception 'skip reason is not valid' using errcode = '22023';
    end if;
    if v_reason in ('gate_locked'::public.visit_skip_reason, 'dog_loose'::public.visit_skip_reason)
       and not exists (
         select 1
         from public.visit_photos p
         join storage.objects o
           on o.bucket_id = 'visit-photos'
          and o.name = p.storage_path
         where p.visit_id = v_visit.id
           and p.org_id = v_visit.org_id
           and p.kind = 'issue'::public.visit_photo_kind
       ) then
      raise exception 'gate locked and dog loose need an issue photo' using errcode = '22023';
    end if;
    update public.visits
    set status = 'skipped',
        skip_reason = v_reason
    where id = v_visit.id;
    v_event := 'skipped';
  elsif p_kind = 'visit_reopen' then
    if v_visit.status is distinct from 'completed'::public.visit_status then
      raise exception 'that visit cannot be reopened' using errcode = '22023';
    end if;
    if v_visit.completed_after_cancel then
      raise exception 'a flagged completion cannot be reopened' using errcode = '22023';
    end if;
    if v_visit.reopen_until is null or pg_catalog.now() > v_visit.reopen_until then
      raise exception 'that visit can no longer be reopened' using errcode = '22023';
    end if;
    update public.visits
    set status = 'in_progress'
    where id = v_visit.id;
    v_event := 'reopened';
    v_entry := 'job';
  elsif p_kind = 'visit_set_crew_size' then
    if v_visit.status = 'cancelled'::public.visit_status or not (v_in_window or v_active) then
      raise exception 'that visit cannot be changed' using errcode = '22023';
    end if;
    v_size := (p_payload->>'crew_size')::integer;
    if v_size is null or v_size < 1 or v_size > 12 then
      raise exception 'crew size must be from 1 to 12' using errcode = '22023';
    end if;
    update public.visits set crew_size = v_size where id = v_visit.id;
  elsif p_kind = 'visit_set_note' then
    if v_visit.status = 'cancelled'::public.visit_status or not (v_in_window or v_active) then
      raise exception 'that visit cannot be changed' using errcode = '22023';
    end if;
    v_note := nullif(btrim(coalesce(p_payload->>'note', '')), '');
    update public.visits set crew_note = v_note where id = v_visit.id;
  elsif p_kind = 'visit_task_set' then
    if v_visit.status = 'cancelled'::public.visit_status or not (v_in_window or v_active) then
      raise exception 'that visit cannot be changed' using errcode = '22023';
    end if;
    v_task := (p_payload->>'task_id')::uuid;
    v_done := coalesce((p_payload->>'done')::boolean, false);
    if not exists (
      select 1
      from public.visit_tasks t
      where t.id = v_task
        and t.visit_id = v_visit.id
        and t.org_id = v_visit.org_id
    ) then
      raise exception 'task not found' using errcode = 'P0002';
    end if;
    update public.visit_tasks
    set done_at = case when v_done then v_at else null end,
        not_done_reason = case
          when v_done then null
          else nullif(btrim(coalesce(p_payload->>'not_done_reason', '')), '')
        end
    where id = v_task;
  elsif p_kind = 'visit_photo_record' then
    if v_visit.status = 'cancelled'::public.visit_status or not (v_in_window or v_active) then
      raise exception 'that visit cannot take a photo' using errcode = '22023';
    end if;
    begin
      v_photo_kind := (p_payload->>'photo_kind')::public.visit_photo_kind;
    exception
      when invalid_text_representation then
        raise exception 'photo kind is not valid' using errcode = '22023';
    end;
    if v_photo_kind is null then
      raise exception 'photo kind is not valid' using errcode = '22023';
    end if;
    v_lat := (p_payload->>'lat')::double precision;
    v_lng := (p_payload->>'lng')::double precision;
    if (v_lat is null) is distinct from (v_lng is null) then
      raise exception 'photo latitude and longitude are a pair' using errcode = '22023';
    end if;
    insert into public.visit_photos (
      org_id, visit_id, kind, storage_path, taken_at, lat, lng, client_id, device_clock_skewed
    ) values (
      v_visit.org_id,
      v_visit.id,
      v_photo_kind,
      v_visit.org_id::text || '/' || v_visit.id::text || '/' || p_client_id::text || '.jpg',
      least(coalesce((p_payload->>'taken_at')::timestamptz, v_at), pg_catalog.now()),
      v_lat,
      v_lng,
      p_client_id,
      v_skew
    );
  elsif p_kind = 'enhancement_create' then
    if v_visit.status = 'cancelled'::public.visit_status or not (v_in_window or v_active) then
      raise exception 'that visit cannot take an enhancement' using errcode = '22023';
    end if;
    begin
      v_tag := (p_payload->>'tag')::public.enhancement_tag;
    exception
      when invalid_text_representation then
        raise exception 'enhancement tag is not valid' using errcode = '22023';
    end;
    if v_tag is null then
      raise exception 'enhancement tag is not valid' using errcode = '22023';
    end if;
    select coalesce(array_agg(x::uuid), '{}'::uuid[])
      into v_photo_ids
    from jsonb_array_elements_text(coalesce(p_payload->'photo_ids', '[]'::jsonb)) as x;
    insert into public.enhancement_requests (
      org_id, visit_id, property_id, tag, note, photo_ids, client_id
    ) values (
      v_visit.org_id,
      v_visit.id,
      v_visit.property_id,
      v_tag,
      nullif(btrim(coalesce(p_payload->>'note', '')), ''),
      coalesce(v_photo_ids, '{}'::uuid[]),
      p_client_id
    );
  end if;

  if v_event is not null then
    update public.time_entries te
    set ended_at = greatest(te.started_at, v_at)
    where te.visit_id = v_visit.id
      and te.ended_at is null;
  end if;

  if v_entry is not null then
    insert into public.time_entries (
      org_id, crew_id, visit_id, profile_id, kind, started_at, client_id, device_clock_skewed
    ) values (
      v_visit.org_id, v_crew, v_visit.id, (select auth.uid()), v_entry, v_at, p_client_id, v_skew
    );
  end if;

  if v_event is not null then
    insert into public.visit_events (
      org_id, visit_id, kind, profile_id, client_id, payload, occurred_at, device_clock_skewed
    ) values (
      v_visit.org_id,
      v_visit.id,
      v_event,
      (select auth.uid()),
      p_client_id,
      case
        when p_kind = 'visit_skip' then jsonb_build_object('reason', v_reason)
        else '{}'::jsonb
      end,
      v_at,
      v_skew
    );
  end if;

  return 'applied';
end;
$$;

-- Stops on the first error. Earlier items in the batch stay applied.
-- Unexpected database errors stay off the phone. Known crew errors do not.
create or replace function public.crew_sync(p_mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_status text;
  v_results jsonb := '[]'::jsonb;
  v_client uuid;
begin
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
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'client_id', v_item->>'client_id',
          'status', 'error',
          'message', case
            when sqlstate in ('22023', '42501', 'P0002') then sqlerrm
            else 'could not apply that change'
          end
        ));
        exit;
    end;
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;

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
  where cm.org_id = v_org
    and cm.profile_id = (select auth.uid());

  if v_crew is null or not private.is_crew_member(v_org, v_crew) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_today := private.org_local_today(v_org);
  if p_date is null or p_date > v_today + 1 then
    raise exception 'that date is outside the crew window' using errcode = '22023';
  end if;
  -- Yesterday through tomorrow is the normal window. An older date is
  -- readable only while this crew still has a visit in progress or paused.
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
                when v.status = 'cancelled'::public.visit_status then null
                else pa.gate_code
              end,
              'access_notes', case
                when v.status = 'cancelled'::public.visit_status then null
                else pa.access_notes
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

revoke all on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb) from public, anon;
revoke all on function public.crew_day_pack(date) from public, anon;
revoke all on function public.crew_sync(jsonb) from public, anon;

grant execute on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb) to authenticated, service_role;
grant execute on function public.crew_day_pack(date) to authenticated, service_role;
grant execute on function public.crew_sync(jsonb) to authenticated, service_role;
