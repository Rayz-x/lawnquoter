-- S12 (renumbered from 20261010210700, which never applied on hosted):
-- Also reconciles functions that parallel PRs each redefined, so later
-- migrations stopped clobbering earlier ones (three-way merged from the
-- 20261010213300 / 20261010183000 bases):
--   private.crew_apply        = 215600 time corrections + 215700 same-day extra
--   private.crew_apply_impl   = 217300 skip reasons + 217400 S13 + S12 partly done
--   public.crew_day_pack      = 215800 phone revoke + 217400 S13
--   public.office_attention_tray = 215600 + 215700 + 215900 + 217300 + 217400 + S12
-- billing_held already exists from 20261010214900; partly done sets
-- billing_hold_reason = 'partly_done' to satisfy visits_billing_hold_reason_check.
-- S12: Partly done finish with return visit (issue #92).
-- Lead finishes with outcome=partly + reason + after photo; original is held
-- for billing review; a return visit lands unassigned in Needs attention.

alter table public.visits
  add column if not exists billing_held boolean not null default false;

alter table public.visits
  add column if not exists partly_done_reason text;

alter table public.visits
  add column if not exists return_of_visit_id uuid references public.visits(id) on delete set null;

alter table public.visits
  add constraint visits_partly_done_reason_len check (
    partly_done_reason is null
    or length(btrim(partly_done_reason)) between 1 and 500
  );

alter table public.visits
  add constraint visits_return_not_self check (
    return_of_visit_id is null
    or return_of_visit_id is distinct from id
  );

create index if not exists visits_return_of_visit_id_idx
  on public.visits (return_of_visit_id)
  where return_of_visit_id is not null;

create unique index if not exists visits_one_return_per_parent
  on public.visits (return_of_visit_id)
  where return_of_visit_id is not null;

create trigger visits_return_of_org
  before insert or update of org_id, return_of_visit_id on public.visits
  for each row execute function private.child_org_guard('visits', 'return_of_visit_id');

-- Body lives on crew_apply_impl (renamed in lead-for-today). Wrapper unchanged.
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
  if p_kind = 'enhancement_create'
     and private.jsonb_has_money_key(coalesce(p_payload, '{}'::jsonb)) then
    raise exception 'crew payloads cannot include money' using errcode = '22023';
  end if;

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

  if p_kind = 'visit_correct_times' then
    return private.crew_apply_correct_times(
      p_visit_id, p_client_id, p_occurred_at, p_device_now, coalesce(p_payload, '{}'::jsonb)
    );
  end if;

  return private.crew_apply_impl(
    p_kind, p_visit_id, p_client_id, p_occurred_at, p_device_now, p_payload
  );
end;
$$;

revoke all on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  to service_role;

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
  v_crew_name text;
  v_route_status public.route_status;
  v_claimed uuid;
  v_existing text;
  v_existing_visit uuid;
  v_at timestamptz;
  v_skew boolean;
  v_in_window boolean;
  v_active boolean;
  v_mid_cancel boolean;
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
  v_forgot boolean;
  v_outcome text;
  v_partly_reason text;
  v_return_id uuid;
  v_event_payload jsonb := '{}'::jsonb;
begin
  if p_client_id is null or p_visit_id is null or p_kind is null then
    raise exception 'a client_id, visit, and kind are required' using errcode = '22023';
  end if;
  if p_kind not in (
    'visit_start', 'visit_pause', 'visit_resume', 'visit_finish', 'visit_skip',
    'visit_stop', 'visit_reopen', 'visit_set_crew_size', 'visit_set_note', 'visit_task_set',
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

  select r.crew_id, r.status, c.name
    into v_crew, v_route_status, v_crew_name
  from public.routes r
  join public.crews c
    on c.id = r.crew_id
   and c.org_id = r.org_id
  where r.id = v_visit.route_id
    and r.org_id = v_visit.org_id;

  -- Stale finish / cross-crew: a live lead (of any crew) gets a clear message.
  -- A demoted lead still hits not-allowed below.
  if p_kind = 'visit_finish'
     and v_visit.status = 'completed'::public.visit_status
     and exists (
       select 1
       from public.crews c
       where c.org_id = v_visit.org_id
         and private.is_live_crew_lead(c.org_id, c.id)
     ) then
    raise exception 'Already done by %', coalesce(nullif(btrim(v_crew_name), ''), 'another crew')
      using errcode = '22023';
  end if;

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
  v_mid_cancel := v_visit.status = 'cancelled'::public.visit_status
    and v_visit.started_at is not null;
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
    -- Active, or mid-visit cancel (office cancelled after start). Past-day and
    -- past-midnight finishes keep scheduled_date unchanged.
    if not (v_active or v_mid_cancel) then
      raise exception 'that visit cannot be finished' using errcode = '22023';
    end if;
    v_outcome := nullif(btrim(coalesce(p_payload->>'outcome', '')), '');
    if v_outcome is not null and v_outcome is distinct from 'partly' then
      raise exception 'finish outcome is not valid' using errcode = '22023';
    end if;
    select o.timezone into v_tz
    from public.orgs o
    where o.id = v_visit.org_id;
    if v_outcome = 'partly' then
      v_partly_reason := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
      if v_partly_reason is null then
        raise exception 'partly done needs a reason' using errcode = '22023';
      end if;
      if length(v_partly_reason) > 500 then
        v_partly_reason := left(v_partly_reason, 500);
      end if;
      update public.visits
      set status = 'completed',
          completed_at = v_at,
          billing_held = true,
          billing_hold_reason = 'partly_done'::public.billing_hold_reason,
          forgot_to_finish = forgot_to_finish
            or coalesce(started_at, v_at) <= v_at - interval '12 hours',
          partly_done_reason = v_partly_reason,
          reopen_until = null
      where id = v_visit.id;
      if not exists (
        select 1 from public.visits where return_of_visit_id = v_visit.id
      ) then
        insert into public.visits (
          org_id, job_id, property_id,
          sort, occurrence_date, scheduled_date, status,
          crew_size, budget_minutes, return_of_visit_id
        ) values (
          v_visit.org_id,
          v_visit.job_id,
          v_visit.property_id,
          0,
          private.org_local_today(v_visit.org_id),
          null,
          'scheduled'::public.visit_status,
          v_visit.crew_size,
          v_visit.budget_minutes,
          v_visit.id
        )
        returning id into v_return_id;

        insert into public.visit_tasks (
          org_id, visit_id, label, quantity_text, source_line_item_id, notes_crew, sort
        )
        select
          t.org_id,
          v_return_id,
          t.label,
          t.quantity_text,
          t.source_line_item_id,
          t.notes_crew,
          t.sort
        from public.visit_tasks t
        where t.visit_id = v_visit.id
          and t.done_at is null;
      end if;
      select id into v_return_id
      from public.visits
      where return_of_visit_id = v_visit.id;
      v_event_payload := jsonb_build_object(
        'outcome', 'partly',
        'reason', v_partly_reason,
        'return_visit_id', v_return_id
      );
    else
      v_forgot := coalesce(v_visit.started_at, v_at) <= v_at - interval '12 hours';
      update public.visits
      set status = 'completed',
          completed_at = v_at,
          forgot_to_finish = forgot_to_finish or v_forgot,
          reopen_until = case
            when v_mid_cancel then null
            else (
              (private.org_local_today(v_visit.org_id)::text || ' 18:00:00')::timestamp
              at time zone v_tz
            )
          end
      where id = v_visit.id;
    end if;
    v_event := 'finished';
  elsif p_kind = 'visit_stop' then
    -- Mid-visit cancel: crew chooses Stop instead of Finish.
    if not v_mid_cancel then
      raise exception 'that visit cannot be stopped' using errcode = '22023';
    end if;
    update public.time_entries te
    set ended_at = greatest(te.started_at, v_at)
    where te.visit_id = v_visit.id
      and te.ended_at is null;
    return 'applied';
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
    -- Gate/dog proof must satisfy the after-photo rule (kind=after + file).
    if v_reason in ('gate_locked'::public.visit_skip_reason, 'dog_loose'::public.visit_skip_reason)
       and not exists (
         select 1
         from public.visit_photos p
         join storage.objects o
           on o.bucket_id = 'visit-photos'
          and o.name = p.storage_path
         where p.visit_id = v_visit.id
           and p.org_id = v_visit.org_id
           and p.kind = 'after'::public.visit_photo_kind
       ) then
      raise exception 'gate locked and dog loose need an after photo' using errcode = '22023';
    end if;
    v_note := nullif(btrim(coalesce(p_payload->>'note', '')), '');
    if v_reason = 'unsafe'::public.visit_skip_reason and v_note is null then
      raise exception 'an unsafe skip needs a note' using errcode = '22023';
    end if;
    update public.visits
    set status = 'skipped',
        skip_reason = v_reason,
        crew_note = coalesce(v_note, crew_note)
    where id = v_visit.id;
    v_event := 'skipped';
  elsif p_kind = 'visit_reopen' then
    if v_visit.status is distinct from 'completed'::public.visit_status then
      raise exception 'that visit cannot be reopened' using errcode = '22023';
    end if;
    if v_visit.completed_after_cancel or v_visit.billing_held then
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
    if (v_visit.status = 'cancelled'::public.visit_status and not v_mid_cancel)
       or not (v_in_window or v_active or v_mid_cancel) then
      raise exception 'that visit cannot be changed' using errcode = '22023';
    end if;
    v_size := (p_payload->>'crew_size')::integer;
    if v_size is null or v_size < 1 or v_size > 12 then
      raise exception 'crew size must be from 1 to 12' using errcode = '22023';
    end if;
    update public.visits set crew_size = v_size where id = v_visit.id;
  elsif p_kind = 'visit_set_note' then
    if (v_visit.status = 'cancelled'::public.visit_status and not v_mid_cancel)
       or not (v_in_window or v_active or v_mid_cancel) then
      raise exception 'that visit cannot be changed' using errcode = '22023';
    end if;
    v_note := nullif(btrim(coalesce(p_payload->>'note', '')), '');
    update public.visits set crew_note = v_note where id = v_visit.id;
  elsif p_kind = 'visit_task_set' then
    if (v_visit.status = 'cancelled'::public.visit_status and not v_mid_cancel)
       or not (v_in_window or v_active or v_mid_cancel) then
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
    if (v_visit.status = 'cancelled'::public.visit_status and not v_mid_cancel) then
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
    -- Mid-visit cancel also allows photos while finishing/stopping.
    if v_visit.status = 'completed'::public.visit_status then
      if not v_visit.photo_pending or v_photo_kind is distinct from 'after'::public.visit_photo_kind then
        raise exception 'that visit cannot take a photo' using errcode = '22023';
      end if;
    elsif v_mid_cancel then
      null;
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
    if p_kind = 'visit_skip' then
      v_event_payload := jsonb_build_object('reason', v_reason);
    end if;
    insert into public.visit_events (
      org_id, visit_id, kind, profile_id, client_id, payload, occurred_at, device_clock_skewed
    ) values (
      v_visit.org_id,
      v_visit.id,
      v_event,
      (select auth.uid()),
      p_client_id,
      case
        when p_kind = 'visit_skip' then jsonb_strip_nulls(
          jsonb_build_object('reason', v_reason, 'note', v_note)
        )
        else v_event_payload
      end,
      v_at,
      v_skew
    );
  end if;

  return 'applied';
end;
$$;

revoke all on function private.crew_apply_impl(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function private.crew_apply_impl(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  to service_role;

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
            'forgot_to_finish', v.forgot_to_finish,
            'completed_by_crew', case
              when v.status = 'completed'::public.visit_status then rc.name
              else null
            end,
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
        left join public.crews rc
          on rc.id = vr.crew_id
         and rc.org_id = vr.org_id
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
      v.over_budget,
      v.clock_off,
      v.forgot_to_finish,
      coalesce(j.title, 'Visit') as title,
      a.name as account_name,
      p.address_line1,
      p.city,
      (
        select e.id
        from public.enhancement_requests e
        where e.visit_id = v.id
          and e.org_id = v.org_id
          and e.status = 'new'::public.enhancement_status
        order by e.received_at asc, e.created_at asc
        limit 1
      ) as enhancement_id,
      (
        select e.same_day_approved_until
        from public.enhancement_requests e
        where e.visit_id = v.id
          and e.org_id = v.org_id
          and e.status = 'new'::public.enhancement_status
          and e.same_day_approved_until is not null
          and e.same_day_approved_until > pg_catalog.now()
        order by e.received_at asc, e.created_at asc
        limit 1
      ) as same_day_approved_until,
      (public.job_seasonal_warn_state(j.id, v_as_of) = 'warn') as seasonal_warn,
      case
        when v.photo_lost then 'Photo lost'
        when v.return_of_visit_id is not null then 'Return visit'
        when v.completed_after_cancel then 'Completed after cancel'
        when v.over_budget then 'Over budget'
        when v.clock_off then 'Clock off'
        when v.forgot_to_finish
          or (
            v.status in (
              'in_progress'::public.visit_status,
              'paused'::public.visit_status
            )
            and v.started_at is not null
            and v.started_at <= pg_catalog.now() - interval '12 hours'
          )
          then 'Forgot to finish'
        when exists (
          select 1
          from public.enhancement_requests e
          where e.visit_id = v.id
            and e.org_id = v.org_id
            and e.status = 'new'::public.enhancement_status
        ) then (
          select
            case
              when e.same_day_approved_until is not null
               and e.same_day_approved_until > pg_catalog.now()
              then 'Upsell: ' || e.tag::text || ' · Approved today'
              else 'Upsell: ' || e.tag::text
            end
          from public.enhancement_requests e
          where e.visit_id = v.id
            and e.org_id = v.org_id
            and e.status = 'new'::public.enhancement_status
          order by e.received_at asc, e.created_at asc
          limit 1
        )
        when v.status in (
          'skipped'::public.visit_status,
          'cant_complete'::public.visit_status
        )
          and v.skip_reason = 'unsafe'::public.visit_skip_reason
          then 'Unsafe — urgent'
        when v.status in (
          'skipped'::public.visit_status,
          'cant_complete'::public.visit_status
        )
          and v.skip_reason is not null
          then initcap(replace(v.skip_reason::text, '_', ' '))
        else null
      end as reason,
      case
        when v.photo_lost
          or v.completed_after_cancel
          or v.over_budget
          or v.clock_off
          or v.forgot_to_finish
          or (
            v.status in (
              'in_progress'::public.visit_status,
              'paused'::public.visit_status
            )
            and v.started_at is not null
            and v.started_at <= pg_catalog.now() - interval '12 hours'
          )
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
        'reason', reason,
        'enhancement_id', enhancement_id,
        'same_day_approved_until', same_day_approved_until,
        'seasonal_warn', seasonal_warn
      ) as item
    from base
    where bucket is not null
  )
  select
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date') nulls first, item ->> 'title')
      filter (where bucket = 'unassigned'), '[]'::jsonb),
    coalesce(jsonb_agg(item order by (item ->> 'scheduled_date'), item ->> 'title')
      filter (where bucket = 'overdue'), '[]'::jsonb),
    coalesce(jsonb_agg(item order by
        case when item ->> 'reason' = 'Unsafe — urgent' then 0 else 1 end,
        (item ->> 'scheduled_date') nulls last,
        item ->> 'title')
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
