-- S14: Photo pending / lost states (issue #94).
-- Offline finish may complete before the after photo arrives. Billing waits
-- until photo_pending clears. A missing local blob flags photo_lost.

alter table public.visits
  add column photo_pending boolean not null default false,
  add column photo_lost boolean not null default false;

alter table public.visits
  add constraint visits_photo_pending_status check (
    photo_pending = false
    or status = 'completed'::public.visit_status
  );

alter table public.visits
  add constraint visits_photo_lost_status check (
    photo_lost = false
    or status = 'completed'::public.visit_status
  );


create or replace function private.visits_guard_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crew uuid;
  v_has_after boolean;
begin
  if tg_op = 'UPDATE'
     and old.status = 'completed'::public.visit_status
     and new.status = 'cancelled'::public.visit_status then
    new.status := 'completed'::public.visit_status;
    new.completed_after_cancel := true;
    new.completed_at := coalesce(new.completed_at, old.completed_at, now());
  elsif new.status = 'completed'::public.visit_status
        and (
          tg_op = 'INSERT'
          or old.status is distinct from 'completed'::public.visit_status
        ) then
    select exists (
      select 1
      from public.visit_photos p
      join storage.objects o
        on o.bucket_id = 'visit-photos'
       and o.name = p.storage_path
      where p.visit_id = new.id
        and p.org_id = new.org_id
        and p.kind = 'after'::public.visit_photo_kind
    ) into v_has_after;
    -- S14: offline finish may complete before the after photo arrives.
    new.photo_pending := not v_has_after;
    if tg_op = 'UPDATE' and old.status = 'cancelled'::public.visit_status then
      new.completed_after_cancel := true;
    end if;
    if new.completed_at is null then
      new.completed_at := now();
    end if;
  elsif tg_op = 'UPDATE'
        and old.status = 'completed'::public.visit_status
        and new.status is distinct from 'completed'::public.visit_status then
    new.completed_after_cancel := false;
    new.photo_pending := false;
    new.photo_lost := false;
  end if;

  if new.status in (
       'in_progress'::public.visit_status,
       'paused'::public.visit_status
     )
     and new.route_id is not null then
    select r.crew_id into v_crew
    from public.routes r
    where r.id = new.route_id
      and r.org_id = new.org_id;

    if v_crew is not null then
      perform 1
      from public.crews c
      where c.id = v_crew
        and c.org_id = new.org_id
      for update;

      if exists (
        select 1
        from public.visits v
        join public.routes r on r.id = v.route_id
        where r.crew_id = v_crew
          and r.org_id = new.org_id
          and v.id is distinct from new.id
          and v.scheduled_date = new.scheduled_date
          and v.status in (
            'in_progress'::public.visit_status,
            'paused'::public.visit_status
          )
      ) then
        raise exception 'only one in-progress visit per crew' using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;


create or replace function private.visit_photos_clear_photo_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'after'::public.visit_photo_kind then
    update public.visits
    set photo_pending = false,
        photo_lost = false
    where id = new.visit_id
      and org_id = new.org_id
      and (photo_pending or photo_lost);
  end if;
  return new;
end;
$$;

drop trigger if exists visit_photos_clear_photo_pending on public.visit_photos;
create trigger visit_photos_clear_photo_pending
  after insert on public.visit_photos
  for each row execute function private.visit_photos_clear_photo_pending();

revoke all on function private.visit_photos_clear_photo_pending() from public, anon;
grant execute on function private.visit_photos_clear_photo_pending() to service_role;

create or replace function private.crew_apply_impl(
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
  v_photo_client uuid;
  v_matched uuid;
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
    'visit_photo_record', 'visit_flag_photo_lost', 'enhancement_create'
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
    if v_visit.status = 'cancelled'::public.visit_status then
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
    -- Offline finish may land first; after photos may arrive while photo_pending.
    if v_visit.status = 'completed'::public.visit_status then
      if not v_visit.photo_pending or v_photo_kind is distinct from 'after'::public.visit_photo_kind then
        raise exception 'that visit cannot take a photo' using errcode = '22023';
      end if;
    elsif not (v_in_window or v_active) then
      raise exception 'that visit cannot take a photo' using errcode = '22023';
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
  elsif p_kind = 'visit_flag_photo_lost' then
    if v_visit.status is distinct from 'completed'::public.visit_status then
      raise exception 'that visit cannot be flagged' using errcode = '22023';
    end if;
    update public.visits
    set photo_lost = true,
        photo_pending = true
    where id = v_visit.id;
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
    begin
      select coalesce(array_agg(x::uuid), '{}'::uuid[])
        into v_photo_ids
      from jsonb_array_elements_text(coalesce(p_payload->'photo_ids', '[]'::jsonb)) as x;
    exception
      when invalid_text_representation then
        raise exception 'enhancement photo is not valid' using errcode = '22023';
    end;
    v_photo_ids := coalesce(v_photo_ids, '{}'::uuid[]);
    begin
      if nullif(btrim(coalesce(p_payload->>'photo_client_id', '')), '') is not null then
        v_photo_client := (p_payload->>'photo_client_id')::uuid;
      end if;
    exception
      when invalid_text_representation then
        raise exception 'enhancement photo is not valid' using errcode = '22023';
    end;
    if v_photo_client is not null then
      select p.id
        into v_matched
      from public.visit_photos p
      where p.org_id = v_visit.org_id
        and p.visit_id = v_visit.id
        and p.client_id = v_photo_client;
      if v_matched is null then
        raise exception 'enhancement photo must belong to this visit' using errcode = '22023';
      end if;
      if not v_matched = any (v_photo_ids) then
        v_photo_ids := v_photo_ids || v_matched;
      end if;
    end if;
    if exists (
      select 1
      from unnest(v_photo_ids) as pid
      where not exists (
        select 1
        from public.visit_photos p
        where p.id = pid
          and p.org_id = v_visit.org_id
          and p.visit_id = v_visit.id
      )
    ) then
      raise exception 'enhancement photo must belong to this visit' using errcode = '22023';
    end if;
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

create or replace function public.office_attention_tray(p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_as_of date;
  v_unassigned jsonb := '[]'::jsonb;
  v_overdue jsonb := '[]'::jsonb;
  v_reschedule jsonb := '[]'::jsonb;
  v_flags jsonb := '[]'::jsonb;
begin
  if v_org is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_read_office_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_as_of := coalesce(p_as_of, private.org_local_today(v_org));

  with base as (
    select
      v.id,
      v.property_id,
      v.scheduled_date,
      v.status::text as status,
      v.route_id,
      v.budget_minutes,
      v.completed_after_cancel,
      coalesce(j.title, 'Visit') as title,
      a.name as account_name,
      p.address_line1,
      p.city,
      case
        when v.photo_lost then 'Photo lost'
        when v.completed_after_cancel then 'Completed after cancel'
        when exists (
          select 1
          from public.enhancement_requests e
          where e.visit_id = v.id
            and e.org_id = v.org_id
            and e.status = 'new'::public.enhancement_status
        ) then (
          select 'Upsell: ' || e.tag::text
          from public.enhancement_requests e
          where e.visit_id = v.id
            and e.org_id = v.org_id
            and e.status = 'new'::public.enhancement_status
          order by e.received_at asc, e.created_at asc
          limit 1
        )
        else null
      end as reason,
      case
        when v.photo_lost
          or v.completed_after_cancel
          or exists (
            select 1
            from public.enhancement_requests e
            where e.visit_id = v.id
              and e.org_id = v.org_id
              and e.status = 'new'::public.enhancement_status
          )
          then 'flags'
        when v.status in (
          'skipped'::public.visit_status,
          'cant_complete'::public.visit_status
        )
          then 'needs_reschedule'
        when v.status in (
          'scheduled'::public.visit_status,
          'in_progress'::public.visit_status,
          'paused'::public.visit_status
        )
          and v.scheduled_date is not null
          and v.scheduled_date < v_as_of
          then 'overdue'
        when v.status = 'scheduled'::public.visit_status
          and v.route_id is null
          and (v.scheduled_date is null or v.scheduled_date >= v_as_of)
          then 'unassigned'
        else null
      end as bucket
    from public.visits v
    left join public.jobs j on j.id = v.job_id
    left join public.properties p on p.id = v.property_id
    left join public.accounts a on a.id = p.account_id
    where v.org_id = v_org
      and v.status <> 'cancelled'::public.visit_status
  ),
  items as (
    select
      bucket,
      jsonb_build_object(
        'id', id,
        'property_id', property_id,
        'scheduled_date', scheduled_date,
        'status', status,
        'title', title,
        'account_name', account_name,
        'address_line1', address_line1,
        'city', city,
        'budget_minutes', budget_minutes,
        'reason', reason
      ) as item
    from base
    where bucket is not null
  )
  select
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date') nulls first, item ->> 'title')
      filter (where bucket = 'unassigned'), '[]'::jsonb),
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date'), item ->> 'title')
      filter (where bucket = 'overdue'), '[]'::jsonb),
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date') nulls last, item ->> 'title')
      filter (where bucket = 'needs_reschedule'), '[]'::jsonb),
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date') nulls last, item ->> 'title')
      filter (where bucket = 'flags'), '[]'::jsonb)
  into v_unassigned, v_overdue, v_reschedule, v_flags
  from items;

  return jsonb_build_object(
    'as_of', v_as_of,
    'counts', jsonb_build_object(
      'unassigned', jsonb_array_length(v_unassigned),
      'overdue', jsonb_array_length(v_overdue),
      'needs_reschedule', jsonb_array_length(v_reschedule),
      'flags', jsonb_array_length(v_flags)
    ),
    'unassigned', v_unassigned,
    'overdue', v_overdue,
    'needs_reschedule', v_reschedule,
    'flags', v_flags
  );
end;
$$;

revoke all on function public.office_attention_tray(date) from public, anon;
grant execute on function public.office_attention_tray(date) to authenticated, service_role;
