-- Jobs and scheduling RPCs.
-- Depends on 20261009190000_jobs_scheduling_schema.sql.
--
-- accepted_quote_task_sources, convert_accepted_quote, generate_agreement_visits,
-- assign_visit, reorder_route_visits, publish_route, cancel_visit, skip_visit,
-- create_crew, add_crew_member, set_crew_lead, my_crews, and
-- update_agreement_schedule.
-- Writes: owner, admin, dispatcher. convert_accepted_quote and
-- update_agreement_schedule also allow sales. anon has no EXECUTE.

-- Accepted line items for a quote.
--
-- quote_accept stores the resolved choice in public.acceptances.selections:
-- a jsonb array of quote_line_items ids from private.resolve_quote_selection.
-- Included lines and the options the customer picked are in that array.
-- Unchosen options are not.
--
-- 20261009180000 keeps that array. accepted_total stays the sum of selected
-- point prices. This function reads selections only. It does not read
-- accepted_total, accepted_not_to_exceed, price, or cost.
--
-- Chosen options are ordinary tasks. notes_crew is the crew instruction
-- from the line, not a customer contact.
create or replace function private.accepted_quote_task_sources(p_quote uuid)
returns table (
  item_id uuid,
  label text,
  quantity_text text,
  notes_crew text,
  hours numeric,
  sort integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select q.org_id into v_org
  from public.quotes q
  where q.id = p_quote;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.name,
    coalesce(
      trim_scale(i.qty)::text || coalesce(' ' || nullif(btrim(i.unit), ''), ''),
      ''
    ),
    i.notes_crew,
    i.hours,
    i.sort
  from public.acceptances a
  join public.quote_versions v
    on v.quote_id = a.quote_id
   and v.version = a.version
  join public.quote_line_items i
    on i.version_id = v.id
   and i.id in (
     select (jsonb_array_elements_text(a.selections))::uuid
   )
  where a.quote_id = p_quote
  order by i.sort, i.id;
end;
$$;

revoke all on function private.accepted_quote_task_sources(uuid) from public, anon;
grant execute on function private.accepted_quote_task_sources(uuid) to authenticated, service_role;

create or replace function public.convert_accepted_quote(
  p_quote_id uuid,
  p_kind text default 'one_time',
  p_frequency text default null,
  p_preferred_dow integer default null,
  p_start_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_version_id uuid;
  v_agreement uuid;
  v_job uuid;
  v_visit uuid;
  v_title text;
  v_crew_size integer := 1;
  v_budget integer;
  v_kind public.agreement_kind;
  v_frequency public.agreement_frequency;
begin
  select * into q
  from public.quotes
  where id = p_quote_id
  for update;

  if not found or q.org_id is distinct from private.current_org_id() then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(q.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if q.status is distinct from 'accepted' then
    raise exception 'only an accepted quote can be converted' using errcode = '22023';
  end if;
  if q.property_id is null then
    raise exception 'quote needs a property' using errcode = '22023';
  end if;

  if p_kind is null or p_kind not in ('one_time', 'recurring') then
    raise exception 'kind must be one_time or recurring' using errcode = '22023';
  end if;
  if p_start_date is null then
    p_start_date := private.org_local_today(q.org_id);
  end if;
  if p_kind = 'one_time' then
    if p_frequency is not null or p_preferred_dow is not null then
      raise exception 'one-time agreements have no frequency' using errcode = '22023';
    end if;
    v_frequency := null;
    p_preferred_dow := null;
  else
    if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'recurring agreements need a weekly, biweekly, or monthly frequency' using errcode = '22023';
    end if;
    if p_preferred_dow is null or p_preferred_dow not between 0 and 6 then
      raise exception 'preferred day of week must be 0 through 6' using errcode = '22023';
    end if;
    v_frequency := p_frequency::public.agreement_frequency;
  end if;
  v_kind := p_kind::public.agreement_kind;

  select a.id into v_agreement
  from public.agreements a
  where a.quote_id = q.id
    and a.org_id = q.org_id;
  if v_agreement is not null then
    if not exists (
      select 1
      from public.agreements a
      where a.id = v_agreement
        and a.kind = v_kind
        and a.frequency is not distinct from v_frequency
        and a.preferred_dow is not distinct from p_preferred_dow
        and a.start_date = p_start_date
    ) then
      raise exception 'quote is already converted with a different schedule' using errcode = '22023';
    end if;
    select j.id into v_job
    from public.jobs j
    where j.agreement_id = v_agreement
      and j.org_id = q.org_id
    order by j.created_at, j.id
    limit 1;
    return jsonb_build_object('agreement_id', v_agreement, 'job_id', v_job);
  end if;

  select v.id into v_version_id
  from public.acceptances a
  join public.quote_versions v
    on v.quote_id = a.quote_id
   and v.version = a.version
  where a.quote_id = q.id;

  if v_version_id is null then
    raise exception 'accepted quote has no acceptance' using errcode = 'P0002';
  end if;

  v_title := left(btrim(q.title), 200);
  if v_title is null or length(v_title) < 1 then
    v_title := 'Service quote';
  end if;

  select coalesce(round(sum(s.hours) * 60 / v_crew_size)::integer, 0)
    into v_budget
  from private.accepted_quote_task_sources(q.id) s;

  insert into public.agreements (
    org_id, account_id, property_id, quote_id, quote_version_id,
    kind, frequency, start_date, preferred_dow, status
  ) values (
    q.org_id, q.account_id, q.property_id, q.id, v_version_id,
    v_kind, v_frequency, p_start_date, p_preferred_dow, 'active'
  )
  returning id into v_agreement;

  insert into public.jobs (
    org_id, agreement_id, property_id, quote_id, title, status
  ) values (
    q.org_id, v_agreement, q.property_id, q.id, v_title, 'unscheduled'
  )
  returning id into v_job;

  if v_kind = 'one_time'::public.agreement_kind then
    insert into public.visits (
      org_id, agreement_id, job_id, property_id,
      sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
    ) values (
      q.org_id, v_agreement, v_job, q.property_id,
      0, p_start_date, null, 'scheduled', v_crew_size, v_budget
    )
    returning id into v_visit;

    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, sort
    )
    select
      q.org_id, v_visit, s.label, s.quantity_text, s.notes_crew, s.item_id, s.sort
    from private.accepted_quote_task_sources(q.id) s;
  else
    -- No visit on the start date. The series lands on the preferred weekday.
    -- The first stretch matches the office horizon of 56 days.
    perform private.fill_agreement_visits(
      v_agreement,
      private.org_local_today(q.org_id) + 56
    );
  end if;

  return jsonb_build_object('agreement_id', v_agreement, 'job_id', v_job);
exception
  when unique_violation then
    select a.id into v_agreement
    from public.agreements a
    where a.quote_id = p_quote_id
      and a.org_id = q.org_id;
    if v_agreement is null then
      raise;
    end if;
    if not exists (
      select 1
      from public.agreements a
      where a.id = v_agreement
        and a.kind = v_kind
        and a.frequency is not distinct from v_frequency
        and a.preferred_dow is not distinct from p_preferred_dow
        and a.start_date = p_start_date
    ) then
      raise exception 'quote is already converted with a different schedule' using errcode = '22023';
    end if;
    select j.id into v_job
    from public.jobs j
    where j.agreement_id = v_agreement
    order by j.created_at, j.id
    limit 1;
    return jsonb_build_object('agreement_id', v_agreement, 'job_id', v_job);
end;
$$;

revoke all on function public.convert_accepted_quote(uuid, text, text, integer, date) from public, anon;
grant execute on function public.convert_accepted_quote(uuid, text, text, integer, date) to authenticated, service_role;

-- Recurring dates from greatest(start_date, org today) through p_through,
-- capped about one year past today and by end_date.
-- weekly: every 7 days. biweekly: every 14. monthly: the start date's
-- day-of-month, clamped to the month (31 Jan -> 28 Feb).
-- preferred_dow (Sunday = 0) shifts weekly and biweekly onto that weekday.
-- monthly keeps the calendar day. The loop stores at most 600 dates.
-- No permission check: convert_accepted_quote calls this for sales, and
-- generate_agreement_visits checks dispatch before calling it.
create or replace function private.fill_agreement_visits(p_agreement_id uuid, p_through date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_today date;
  v_from date;
  v_until date;
  v_cursor date;
  v_step integer;
  v_n integer;
  v_dates date[] := array[]::date[];
  v_job uuid;
  v_property uuid;
  v_template uuid;
  v_crew_size integer := 1;
  v_budget integer := 0;
  v_new_ids uuid[];
  v_org uuid;
  v_agreement uuid;
  v_quote uuid;
begin
  if p_through is null then
    raise exception 'through date is required' using errcode = '22023';
  end if;

  select * into a
  from public.agreements
  where id = p_agreement_id
  for update;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if a.kind::text is distinct from 'recurring' or a.frequency is null then
    raise exception 'not a recurring agreement' using errcode = '22023';
  end if;
  if a.frequency::text not in ('weekly', 'biweekly', 'monthly') then
    raise exception 'not a recurring agreement' using errcode = '22023';
  end if;
  if a.status::text is distinct from 'active' then
    raise exception 'agreement is not active' using errcode = '22023';
  end if;

  v_org := a.org_id;
  v_agreement := a.id;
  v_quote := a.quote_id;
  v_today := private.org_local_today(a.org_id);
  v_from := greatest(a.start_date, v_today);
  v_until := least(p_through, v_today + 366);
  if a.end_date is not null and a.end_date < v_until then
    v_until := a.end_date;
  end if;

  if a.frequency::text = 'monthly' then
    v_n := 0;
    loop
      exit when cardinality(v_dates) >= 600;
      v_cursor := (a.start_date + make_interval(months => v_n))::date;
      exit when v_cursor > v_until;
      if v_cursor >= v_from then
        v_dates := v_dates || v_cursor;
      end if;
      v_n := v_n + 1;
      exit when v_n >= 600;
    end loop;
  else
    v_step := case when a.frequency::text = 'biweekly' then 14 else 7 end;
    if a.preferred_dow is null then
      v_cursor := a.start_date;
    else
      v_cursor := a.start_date
        + ((a.preferred_dow - extract(dow from a.start_date)::integer + 7) % 7);
    end if;
    if v_cursor < v_from then
      v_cursor := v_cursor + (((v_from - v_cursor) / v_step) * v_step);
    end if;
    while v_cursor < v_from loop
      v_cursor := v_cursor + v_step;
    end loop;
    while v_cursor <= v_until loop
      exit when cardinality(v_dates) >= 600;
      v_dates := v_dates || v_cursor;
      v_cursor := v_cursor + v_step;
    end loop;
  end if;

  if cardinality(v_dates) = 0 then
    return 0;
  end if;

  select j.id, j.property_id
    into v_job, v_property
  from public.jobs j
  where j.agreement_id = a.id
    and j.org_id = a.org_id
  order by j.created_at, j.id
  limit 1;

  if v_job is null then
    raise exception 'agreement has no job' using errcode = '22023';
  end if;

  select v.id, v.crew_size
    into v_template, v_crew_size
  from public.visits v
  where v.agreement_id = a.id
    and v.org_id = a.org_id
  order by v.occurrence_date, v.created_at, v.id
  limit 1;

  v_crew_size := greatest(coalesce(v_crew_size, 1), 1);

  if v_quote is not null then
    select coalesce(round(sum(s.hours) * 60 / v_crew_size)::integer, 0)
      into v_budget
    from private.accepted_quote_task_sources(v_quote) s;
  elsif v_template is not null then
    select coalesce(v.budget_minutes, 0)
      into v_budget
    from public.visits v
    where v.id = v_template;
  end if;

  with inserted as (
    insert into public.visits (
      org_id, agreement_id, job_id, property_id,
      sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
    )
    select
      v_org, v_agreement, v_job, v_property,
      0, d, d, 'scheduled', v_crew_size, v_budget
    from unnest(v_dates) as d
    on conflict (org_id, agreement_id, occurrence_date) where agreement_id is not null
    do nothing
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[])
    into v_new_ids
  from inserted;

  if cardinality(v_new_ids) = 0 then
    return 0;
  end if;

  if v_template is not null and exists (
    select 1 from public.visit_tasks t where t.visit_id = v_template
  ) then
    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, sort
    )
    select
      v_org, n.id, t.label, t.quantity_text, t.notes_crew, t.source_line_item_id, t.sort
    from unnest(v_new_ids) as n(id)
    cross join public.visit_tasks t
    where t.visit_id = v_template;
  elsif v_quote is not null then
    insert into public.visit_tasks (
      org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, sort
    )
    select
      v_org, n.id, s.label, s.quantity_text, s.notes_crew, s.item_id, s.sort
    from unnest(v_new_ids) as n(id)
    cross join private.accepted_quote_task_sources(v_quote) s;
  end if;

  return cardinality(v_new_ids);
end;
$$;

revoke all on function private.fill_agreement_visits(uuid, date) from public, anon, authenticated;

create or replace function public.generate_agreement_visits(p_agreement_id uuid, p_through date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_through is null then
    raise exception 'through date is required' using errcode = '22023';
  end if;

  select a.org_id into v_org
  from public.agreements a
  where a.id = p_agreement_id;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return private.fill_agreement_visits(p_agreement_id, p_through);
end;
$$;

revoke all on function public.generate_agreement_visits(uuid, date) from public, anon;
grant execute on function public.generate_agreement_visits(uuid, date) to authenticated, service_role;

-- Assign a scheduled visit. scheduled_date changes and occurrence_date does not.
-- p_sort is accepted and ignored: the route is locked and sort becomes max(sort)+1.
-- in_progress and done routes are refused. Completed and cancelled visits
-- are not scheduled, so they cannot be moved.
create or replace function public.assign_visit(
  p_visit_id uuid,
  p_crew_id uuid,
  p_service_date date,
  p_sort integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_route uuid;
  v_status public.route_status;
  v_sort integer;
begin
  if p_service_date is null then
    raise exception 'service date is required' using errcode = '22023';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from private.current_org_id() then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_visit.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_visit.status is distinct from 'scheduled'::public.visit_status then
    raise exception 'only a scheduled visit can be assigned' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.crews c
    where c.id = p_crew_id
      and c.org_id = v_visit.org_id
  ) then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;

  insert into public.routes (org_id, crew_id, date, status)
  values (v_visit.org_id, p_crew_id, p_service_date, 'draft')
  on conflict (org_id, crew_id, date) do nothing
  returning id into v_route;

  if v_route is null then
    select r.id, r.status into v_route, v_status
    from public.routes r
    where r.org_id = v_visit.org_id
      and r.crew_id = p_crew_id
      and r.date = p_service_date
    for update;
  else
    select r.status into v_status
    from public.routes r
    where r.id = v_route
    for update;
  end if;

  if v_status in ('in_progress', 'done') then
    raise exception 'route cannot be changed' using errcode = '22023';
  end if;

  select coalesce(max(v.sort), -1) + 1 into v_sort
  from public.visits v
  where v.route_id = v_route
    and v.id <> v_visit.id;

  update public.visits
  set route_id = v_route,
      scheduled_date = p_service_date,
      sort = v_sort
  where id = v_visit.id;

  update public.jobs
  set status = 'scheduled'
  where id = v_visit.job_id
    and status = 'unscheduled'::public.job_status;

  return v_route;
end;
$$;

revoke all on function public.assign_visit(uuid, uuid, date, integer) from public, anon;
grant execute on function public.assign_visit(uuid, uuid, date, integer) to authenticated, service_role;

create or replace function public.reorder_route_visits(p_route_id uuid, p_visit_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.route_status;
  v_total integer;
  v_open integer;
begin
  select r.org_id, r.status into v_org, v_status
  from public.routes r
  where r.id = p_route_id
  for update;

  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'route not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_status in ('in_progress', 'done') then
    raise exception 'route cannot be changed' using errcode = '22023';
  end if;
  if p_visit_ids is null or cardinality(p_visit_ids) = 0 then
    raise exception 'visit list is empty' using errcode = '22023';
  end if;
  if (
    select count(distinct picked)
    from unnest(p_visit_ids) as picked
  ) <> cardinality(p_visit_ids) then
    raise exception 'duplicate visit' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.visits v
  where v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status;

  select count(*) into v_open
  from public.visits v
  where v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status
    and v.id = any(p_visit_ids);

  if v_total <> cardinality(p_visit_ids) or v_open <> v_total then
    raise exception 'reorder requires every scheduled visit on the route' using errcode = '22023';
  end if;

  update public.visits v
  set sort = u.ord::integer - 1
  from unnest(p_visit_ids) with ordinality as u(id, ord)
  where v.id = u.id
    and v.route_id = p_route_id
    and v.org_id = v_org
    and v.status = 'scheduled'::public.visit_status;
end;
$$;

revoke all on function public.reorder_route_visits(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_route_visits(uuid, uuid[]) to authenticated, service_role;

-- Cancel keeps the occurrence row. The next generate sees the unique key and
-- does not recreate that date. The reason is an office note, not a crew field.
create or replace function public.cancel_visit(p_visit_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_reason text;
begin
  v_reason := btrim(coalesce(p_reason, ''));
  if length(v_reason) < 1 or length(v_reason) > 500 then
    raise exception 'a cancel reason is required' using errcode = '22023';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from private.current_org_id() then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_visit.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_visit.status = 'completed'::public.visit_status then
    raise exception 'a completed visit cannot be cancelled' using errcode = '22023';
  end if;
  if v_visit.status = 'cancelled'::public.visit_status then
    return;
  end if;

  update public.visits
  set status = 'cancelled',
      skip_reason = null
  where id = v_visit.id;

  insert into public.visit_office_notes (visit_id, org_id, note)
  values (v_visit.id, v_visit.org_id, v_reason)
  on conflict (visit_id) do update
    set note = excluded.note;
end;
$$;

revoke all on function public.cancel_visit(uuid, text) from public, anon;
grant execute on function public.cancel_visit(uuid, text) to authenticated, service_role;

create or replace function public.skip_visit(p_visit_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_reason public.visit_skip_reason;
begin
  begin
    v_reason := p_reason::public.visit_skip_reason;
  exception
    when invalid_text_representation then
      raise exception 'skip reason is not valid' using errcode = '22023';
  end;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from private.current_org_id() then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_visit.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_visit.status in ('completed'::public.visit_status, 'cancelled'::public.visit_status) then
    raise exception 'that visit cannot be skipped' using errcode = '22023';
  end if;

  update public.visits
  set status = 'skipped',
      skip_reason = v_reason
  where id = v_visit.id;
end;
$$;

revoke all on function public.skip_visit(uuid, text) from public, anon;
grant execute on function public.skip_visit(uuid, text) to authenticated, service_role;

create or replace function public.publish_route(p_route_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route public.routes;
  v_at timestamptz;
begin
  select * into v_route
  from public.routes
  where id = p_route_id
  for update;

  if not found or v_route.org_id is distinct from private.current_org_id() then
    raise exception 'route not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_route.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_route.status = 'published' and v_route.published_at is not null then
    return v_route.published_at;
  end if;
  if v_route.status in ('in_progress', 'done') then
    raise exception 'route cannot be published' using errcode = '22023';
  end if;

  v_at := now();
  update public.routes
  set status = 'published',
      published_at = v_at
  where id = v_route.id;

  return v_at;
end;
$$;

revoke all on function public.publish_route(uuid) from public, anon;
grant execute on function public.publish_route(uuid) to authenticated, service_role;

create or replace function public.create_crew(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_id uuid;
begin
  v_org := private.current_org_id();
  if v_org is null or not private.can_dispatch(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'crew name is required' using errcode = '22023';
  end if;

  insert into public.crews (org_id, name)
  values (v_org, v_name)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_crew(text) from public, anon;
grant execute on function public.create_crew(text) to authenticated, service_role;

create or replace function public.add_crew_member(p_crew_id uuid, p_profile_id uuid)
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

  insert into public.crew_members (org_id, crew_id, profile_id)
  values (v_org, p_crew_id, p_profile_id);
end;
$$;

revoke all on function public.add_crew_member(uuid, uuid) from public, anon;
grant execute on function public.add_crew_member(uuid, uuid) to authenticated, service_role;

-- The lead is a crew_lead who already belongs to this crew, or who is added
-- here. A person can belong to one crew in the org.
-- Step 11 start/finish must read crews.default_lead_id at that moment.
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
  on conflict (org_id, profile_id) do nothing;

  if not exists (
    select 1
    from public.crew_members cm
    where cm.crew_id = p_crew_id
      and cm.profile_id = p_profile_id
  ) then
    raise exception 'that person is already on another crew' using errcode = '23505';
  end if;

  update public.crews
  set default_lead_id = p_profile_id
  where id = p_crew_id;
end;
$$;

revoke all on function public.set_crew_lead(uuid, uuid) from public, anon;
grant execute on function public.set_crew_lead(uuid, uuid) to authenticated, service_role;

-- Crews and members for the caller. No prices, phone, email, or customer fields.
create or replace function public.my_crews()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.current_org_id();
  if v_org is null or (select auth.uid()) is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'active', c.active,
        'default_lead_id', c.default_lead_id,
        'members', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'profile_id', cm.profile_id,
              'full_name', p.full_name
            )
            order by p.full_name, cm.profile_id
          ), '[]'::jsonb)
          from public.crew_members cm
          join public.profiles p on p.id = cm.profile_id
          where cm.crew_id = c.id
            and cm.org_id = c.org_id
        )
      )
      order by c.name, c.id
    )
    from public.crews c
    where c.org_id = v_org
      and exists (
        select 1
        from public.crew_members mine
        join public.memberships m
          on m.org_id = mine.org_id
         and m.user_id = mine.profile_id
        where mine.crew_id = c.id
          and mine.org_id = c.org_id
          and mine.profile_id = (select auth.uid())
          and m.status = 'active'::public.membership_status
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_crews() from public, anon;
grant execute on function public.my_crews() to authenticated, service_role;

-- Kind, frequency, preferred day, and start date. Owner, admin, dispatcher,
-- and sales. Other agreement columns stay on their own grants.
create or replace function public.update_agreement_schedule(
  p_agreement_id uuid,
  p_kind text,
  p_frequency text default null,
  p_preferred_dow integer default null,
  p_start_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_kind public.agreement_kind;
  v_frequency public.agreement_frequency;
begin
  select * into a
  from public.agreements
  where id = p_agreement_id
  for update;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status = 'ended'::public.agreement_status then
    raise exception 'ended agreements cannot be changed' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception 'start date is required' using errcode = '22023';
  end if;
  if a.end_date is not null and a.end_date < p_start_date then
    raise exception 'start date is after the agreement ends' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('one_time', 'recurring') then
    raise exception 'kind must be one_time or recurring' using errcode = '22023';
  end if;

  if p_kind = 'one_time' then
    v_frequency := null;
    p_preferred_dow := null;
  else
    if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then
      raise exception 'recurring agreements need a weekly, biweekly, or monthly frequency' using errcode = '22023';
    end if;
    if p_preferred_dow is null or p_preferred_dow not between 0 and 6 then
      raise exception 'preferred day of week must be 0 through 6' using errcode = '22023';
    end if;
    v_frequency := p_frequency::public.agreement_frequency;
  end if;
  v_kind := p_kind::public.agreement_kind;

  update public.agreements
  set kind = v_kind,
      frequency = v_frequency,
      preferred_dow = p_preferred_dow,
      start_date = p_start_date
  where id = a.id;
end;
$$;

revoke all on function public.update_agreement_schedule(uuid, text, text, integer, date) from public, anon;
grant execute on function public.update_agreement_schedule(uuid, text, text, integer, date) to authenticated, service_role;
