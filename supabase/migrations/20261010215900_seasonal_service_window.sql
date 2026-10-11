-- Restacked on main tip (photo_pending/photo_lost from #163).
-- S05: Seasonal one-time services (aeration / cleanup) sit in a window with a
-- warn date and turn red when still unscheduled after that date.

alter table public.services
  add column if not exists window_start date,
  add column if not exists window_end date,
  add column if not exists warn_date date;

alter table public.services
  drop constraint if exists services_seasonal_window_complete;

alter table public.services
  add constraint services_seasonal_window_complete check (
    (
      window_start is null
      and window_end is null
      and warn_date is null
    )
    or (
      window_start is not null
      and window_end is not null
      and warn_date is not null
      and window_start <= warn_date
      and warn_date <= window_end
    )
  );

alter table public.jobs
  add column if not exists service_id uuid references public.services(id) on delete set null;

create index if not exists jobs_service_id_idx on public.jobs (service_id);

-- Resolve the seasonal window for a job: explicit service_id, else a quote line
-- item whose service has a warn date.
create or replace function private.job_seasonal_window(p_job_id uuid)
returns table (
  window_start date,
  window_end date,
  warn_date date
)
language sql
stable
set search_path = ''
as $$
  select x.window_start, x.window_end, x.warn_date
  from (
    select s.window_start, s.window_end, s.warn_date, 0 as pref
    from public.jobs j
    join public.services s on s.id = j.service_id
    where j.id = p_job_id
      and s.window_start is not null
      and s.window_end is not null
      and s.warn_date is not null
    union all
    select s.window_start, s.window_end, s.warn_date, 1 as pref
    from public.jobs j
    join public.quotes q on q.id = j.quote_id
    join public.acceptances a on a.quote_id = q.id
    join public.quote_versions v
      on v.quote_id = a.quote_id
     and v.version = a.version
    join public.quote_line_items li on li.version_id = v.id
    join public.services s on s.id = li.service_id
    where j.id = p_job_id
      and j.service_id is null
      and s.window_start is not null
      and s.window_end is not null
      and s.warn_date is not null
  ) x
  order by x.pref, x.warn_date
  limit 1;
$$;

revoke all on function private.job_seasonal_window(uuid) from public, anon, authenticated;
grant execute on function private.job_seasonal_window(uuid) to authenticated, service_role;

-- none | ok | warn | cleared — mirrors apps/web seasonalWarnState.
create or replace function public.job_seasonal_warn_state(
  p_job_id uuid,
  p_as_of date default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_as_of date;
  v_window_start date;
  v_window_end date;
  v_warn_date date;
  v_scheduled boolean;
  v_org uuid := private.current_org_id();
begin
  if v_org is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_read_office_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_job
  from public.jobs j
  where j.id = p_job_id
    and j.org_id = v_org;

  if not found then
    return 'none';
  end if;

  v_as_of := coalesce(p_as_of, private.org_local_today(v_job.org_id));

  select w.window_start, w.window_end, w.warn_date
    into v_window_start, v_window_end, v_warn_date
  from private.job_seasonal_window(p_job_id) w;

  if v_warn_date is null then
    return 'none';
  end if;

  v_scheduled :=
    v_job.status is distinct from 'unscheduled'::public.job_status
    or exists (
      select 1
      from public.visits v
      where v.job_id = p_job_id
        and v.org_id = v_org
        and v.scheduled_date is not null
        and v.status <> 'cancelled'::public.visit_status
    );

  if v_scheduled then
    return 'cleared';
  end if;

  if v_as_of < v_window_start or v_as_of > v_window_end then
    return 'ok';
  end if;

  if v_as_of >= v_warn_date then
    return 'warn';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.job_seasonal_warn_state(uuid, date) from public, anon;
grant execute on function public.job_seasonal_warn_state(uuid, date) to authenticated, service_role;

-- Stamp service_id on convert when an accepted line points at a seasonal service.
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
  v_service uuid;
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

  -- Prefer a seasonal one-time service from accepted lines; else any service_id.
  select coalesce(
    (
      select li.service_id
      from private.accepted_quote_task_sources(q.id) src
      join public.quote_line_items li on li.id = src.item_id
      join public.services svc on svc.id = li.service_id
      where svc.warn_date is not null
      order by src.sort, li.id
      limit 1
    ),
    (
      select li.service_id
      from private.accepted_quote_task_sources(q.id) src
      join public.quote_line_items li on li.id = src.item_id
      where li.service_id is not null
      order by src.sort, li.id
      limit 1
    )
  )
  into v_service;

  insert into public.agreements (
    org_id, account_id, property_id, quote_id, quote_version_id,
    kind, frequency, start_date, preferred_dow, status
  ) values (
    q.org_id, q.account_id, q.property_id, q.id, v_version_id,
    v_kind, v_frequency, p_start_date, p_preferred_dow, 'active'
  )
  returning id into v_agreement;

  insert into public.jobs (
    org_id, agreement_id, property_id, quote_id, service_id, title, status
  ) values (
    q.org_id, v_agreement, q.property_id, q.id, v_service, v_title, 'unscheduled'
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

-- Attention tray: expose seasonal_warn on each item for the red badge.
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
      (public.job_seasonal_warn_state(j.id, v_as_of) = 'warn') as seasonal_warn,
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
        'reason', reason,
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
