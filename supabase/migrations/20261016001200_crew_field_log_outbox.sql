-- Offline crew logs for chemical applications, snow events, and irrigation zones.
-- private.crew_apply keeps every existing kind. The three field-log kinds write
-- through private.crew_apply_field_log. Tables are created only when missing so
-- this can land before or after the office log migrations.

create table if not exists public.chemical_applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  product text not null,
  rate text not null,
  epa_reg_no text not null,
  temp_f numeric not null,
  wind_mph numeric not null,
  conditions text,
  applied_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chemical_applications_product_len check (length(btrim(product)) between 1 and 120),
  constraint chemical_applications_rate_len check (length(btrim(rate)) between 1 and 40),
  constraint chemical_applications_epa_len check (length(btrim(epa_reg_no)) between 1 and 40),
  constraint chemical_applications_conditions_len check (conditions is null or length(btrim(conditions)) between 1 and 80),
  constraint chemical_applications_temp_range check (temp_f between -40 and 130),
  constraint chemical_applications_wind_range check (wind_mph between 0 and 100)
);

create index if not exists chemical_applications_org_id_idx on public.chemical_applications (org_id);
create index if not exists chemical_applications_visit_id_idx on public.chemical_applications (visit_id);

alter table public.chemical_applications enable row level security;
alter table public.chemical_applications force row level security;

drop policy if exists chemical_applications_select on public.chemical_applications;
create policy chemical_applications_select on public.chemical_applications
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );

drop policy if exists chemical_applications_insert on public.chemical_applications;
create policy chemical_applications_insert on public.chemical_applications
  for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and (
      (select private.can_dispatch(org_id))
      or private.crew_can_read_visit(org_id, visit_id)
    )
  );

revoke all on table public.chemical_applications from public, anon, authenticated;
grant select, insert on table public.chemical_applications to authenticated;
grant all on table public.chemical_applications to service_role;

create table if not exists public.snow_event_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  trigger_depth_in numeric not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  materials text not null,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint snow_event_logs_trigger_range check (trigger_depth_in between 0 and 48),
  constraint snow_event_logs_span check (ended_at >= started_at),
  constraint snow_event_logs_materials_len check (length(btrim(materials)) between 1 and 200)
);

create index if not exists snow_event_logs_org_id_idx on public.snow_event_logs (org_id);
create index if not exists snow_event_logs_visit_id_idx on public.snow_event_logs (visit_id);

alter table public.snow_event_logs enable row level security;
alter table public.snow_event_logs force row level security;

drop policy if exists snow_event_logs_select on public.snow_event_logs;
create policy snow_event_logs_select on public.snow_event_logs
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );

drop policy if exists snow_event_logs_insert on public.snow_event_logs;
create policy snow_event_logs_insert on public.snow_event_logs
  for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and (
      (select private.can_dispatch(org_id))
      or private.crew_can_read_visit(org_id, visit_id)
    )
  );

revoke all on table public.snow_event_logs from public, anon, authenticated;
grant select, insert on table public.snow_event_logs to authenticated;
grant all on table public.snow_event_logs to service_role;

create table if not exists public.irrigation_zone_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  zone_number integer not null,
  note text not null,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint irrigation_zone_notes_zone_range check (zone_number between 1 and 64),
  constraint irrigation_zone_notes_note_len check (length(btrim(note)) between 1 and 500)
);

create index if not exists irrigation_zone_notes_org_id_idx on public.irrigation_zone_notes (org_id);
create index if not exists irrigation_zone_notes_visit_id_idx on public.irrigation_zone_notes (visit_id);

alter table public.irrigation_zone_notes enable row level security;
alter table public.irrigation_zone_notes force row level security;

drop policy if exists irrigation_zone_notes_select on public.irrigation_zone_notes;
create policy irrigation_zone_notes_select on public.irrigation_zone_notes
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );

drop policy if exists irrigation_zone_notes_insert on public.irrigation_zone_notes;
create policy irrigation_zone_notes_insert on public.irrigation_zone_notes
  for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and (
      (select private.can_dispatch(org_id))
      or private.crew_can_read_visit(org_id, visit_id)
    )
  );

revoke all on table public.irrigation_zone_notes from public, anon, authenticated;
grant select, insert on table public.irrigation_zone_notes to authenticated;
grant all on table public.irrigation_zone_notes to service_role;

create or replace function private.crew_apply_field_log(
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
  v_in_window boolean;
  v_product text;
  v_rate text;
  v_epa text;
  v_conditions text;
  v_temp numeric;
  v_wind numeric;
  v_trigger numeric;
  v_started timestamptz;
  v_ended timestamptz;
  v_materials text;
  v_zone integer;
  v_note text;
  v_at timestamptz;
begin
  if p_client_id is null or p_visit_id is null or p_kind is null then
    raise exception 'a client_id, visit, and kind are required' using errcode = '22023';
  end if;
  if p_kind not in ('visit_log_chemical', 'visit_log_snow', 'visit_log_irrigation') then
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

  if private.jsonb_has_money_key(coalesce(p_payload, '{}'::jsonb)) then
    raise exception 'crew payloads cannot include money' using errcode = '22023';
  end if;

  v_in_window := v_route_status is distinct from 'draft'::public.route_status
    and v_visit.scheduled_date between private.org_local_today(v_visit.org_id) - 1
                                    and private.org_local_today(v_visit.org_id) + 1;
  if not v_in_window then
    raise exception 'that visit is not on today''s route' using errcode = '22023';
  end if;

  v_at := least(coalesce(p_occurred_at, pg_catalog.now()), pg_catalog.now());

  if p_kind = 'visit_log_chemical' then
    v_product := btrim(coalesce(p_payload->>'product', ''));
    v_rate := btrim(coalesce(p_payload->>'rate', ''));
    v_epa := btrim(coalesce(p_payload->>'epa_reg_no', ''));
    v_conditions := nullif(btrim(coalesce(p_payload->>'conditions', '')), '');
    if v_product = '' or v_rate = '' or v_epa = '' then
      raise exception 'Product, rate, and EPA registration number are required' using errcode = '22023';
    end if;
    if length(v_product) > 120 or length(v_rate) > 40 or length(v_epa) > 40
       or (v_conditions is not null and length(v_conditions) > 80) then
      raise exception 'Keep product, rate, EPA number, and weather notes shorter' using errcode = '22023';
    end if;
    begin
      v_temp := (p_payload->>'temp_f')::numeric;
      v_wind := (p_payload->>'wind_mph')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Temperature must be between -40 and 130 °F, and wind between 0 and 100 mph'
          using errcode = '22023';
    end;
    if v_temp is null or v_temp < -40 or v_temp > 130 or v_wind is null or v_wind < 0 or v_wind > 100 then
      raise exception 'Temperature must be between -40 and 130 °F, and wind between 0 and 100 mph'
        using errcode = '22023';
    end if;
    insert into public.chemical_applications (
      org_id, visit_id, product, rate, epa_reg_no, temp_f, wind_mph, conditions, applied_at, recorded_by
    ) values (
      v_visit.org_id, v_visit.id, v_product, v_rate, v_epa, v_temp, v_wind, v_conditions, v_at, auth.uid()
    );
  elsif p_kind = 'visit_log_snow' then
    v_materials := btrim(coalesce(p_payload->>'materials', ''));
    if v_materials = '' or length(v_materials) > 200 then
      raise exception 'Materials are required' using errcode = '22023';
    end if;
    begin
      v_trigger := (p_payload->>'trigger_depth_in')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Trigger depth has to be between 0 and 48 inches' using errcode = '22023';
    end;
    if v_trigger is null or v_trigger < 0 or v_trigger > 48 then
      raise exception 'Trigger depth has to be between 0 and 48 inches' using errcode = '22023';
    end if;
    begin
      v_started := (p_payload->>'started_at')::timestamptz;
      v_ended := (p_payload->>'ended_at')::timestamptz;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'The snow event has to end after it starts' using errcode = '22023';
    end;
    if v_started is null or v_ended is null or v_ended < v_started then
      raise exception 'The snow event has to end after it starts' using errcode = '22023';
    end if;
    insert into public.snow_event_logs (
      org_id, visit_id, trigger_depth_in, started_at, ended_at, materials, recorded_by
    ) values (
      v_visit.org_id, v_visit.id, v_trigger, v_started, v_ended, v_materials, auth.uid()
    );
  else
    v_note := btrim(coalesce(p_payload->>'note', ''));
    if v_note = '' then
      raise exception 'A zone note is required' using errcode = '22023';
    end if;
    if length(v_note) > 500 then
      raise exception 'Keep the zone note under 500 characters' using errcode = '22023';
    end if;
    if coalesce(p_payload->>'zone_number', '') !~ '^[0-9]+$' then
      raise exception 'Zone has to be a number from 1 to 64' using errcode = '22023';
    end if;
    v_zone := (p_payload->>'zone_number')::integer;
    if v_zone < 1 or v_zone > 64 then
      raise exception 'Zone has to be a number from 1 to 64' using errcode = '22023';
    end if;
    insert into public.irrigation_zone_notes (
      org_id, visit_id, zone_number, note, recorded_by
    ) values (
      v_visit.org_id, v_visit.id, v_zone, v_note, auth.uid()
    );
  end if;

  return 'applied';
end;
$$;

revoke all on function private.crew_apply_field_log(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;


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

  if p_kind in ('visit_log_chemical', 'visit_log_snow', 'visit_log_irrigation') then
    return private.crew_apply_field_log(
      p_kind, p_visit_id, p_client_id, p_occurred_at, p_device_now, coalesce(p_payload, '{}'::jsonb)
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

