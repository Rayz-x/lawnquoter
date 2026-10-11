-- Restacked on main tip (photo_pending/photo_lost from #163).
-- S16: crew upsell requests stay priceless; office can approve an on-the-spot
-- extra for the rest of the org-local day. Dusty applies hosted.

-- Exclusive end of the org-local calendar day (start of the next local day).
create or replace function private.org_local_day_end(target_org uuid, target_day date default null)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (
    ((coalesce(target_day, private.org_local_today(target_org)) + 1)::text || ' 00:00:00')::timestamp
    at time zone coalesce(
      (select o.timezone from public.orgs o where o.id = target_org),
      'UTC'
    )
  );
$$;

revoke all on function private.org_local_day_end(uuid, date) from public, anon;
grant execute on function private.org_local_day_end(uuid, date) to authenticated, service_role;

alter table public.enhancement_requests
  add column same_day_approved_until timestamptz,
  add column same_day_approved_at timestamptz,
  add column same_day_approved_by uuid references public.profiles(id) on delete set null;

create index enhancement_requests_same_day_until_idx
  on public.enhancement_requests (org_id, same_day_approved_until)
  where same_day_approved_until is not null;

create or replace function public.enhancement_same_day_is_active(p_enhancement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enhancement_requests e
    where e.id = p_enhancement_id
      and e.org_id = private.current_org_id()
      and e.same_day_approved_until is not null
      and e.same_day_approved_until > pg_catalog.now()
      and (
        private.can_read_office_records(e.org_id)
        or private.crew_can_read_visit(e.org_id, e.visit_id)
      )
  );
$$;

revoke all on function public.enhancement_same_day_is_active(uuid) from public, anon;
grant execute on function public.enhancement_same_day_is_active(uuid) to authenticated, service_role;

create or replace function public.office_approve_same_day_extra(p_enhancement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.enhancement_requests;
  v_until timestamptz;
begin
  select * into v_row
  from public.enhancement_requests
  where id = p_enhancement_id
  for update;

  if not found or v_row.org_id is distinct from private.current_org_id() then
    raise exception 'enhancement not found' using errcode = 'P0002';
  end if;
  if not private.can_dispatch(v_row.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_row.status is distinct from 'new'::public.enhancement_status then
    raise exception 'only a new upsell can be approved for same day' using errcode = '22023';
  end if;

  v_until := private.org_local_day_end(v_row.org_id, private.org_local_today(v_row.org_id));

  update public.enhancement_requests
  set same_day_approved_until = v_until,
      same_day_approved_at = pg_catalog.now(),
      same_day_approved_by = (select auth.uid())
  where id = v_row.id;

  return jsonb_build_object(
    'id', v_row.id,
    'same_day_approved_until', v_until
  );
end;
$$;

revoke all on function public.office_approve_same_day_extra(uuid) from public, anon;
grant execute on function public.office_approve_same_day_extra(uuid) to authenticated, service_role;

-- Refuse money keys on upsell sync before the receipt is claimed.
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

  return private.crew_apply_impl(
    p_kind, p_visit_id, p_client_id, p_occurred_at, p_device_now, p_payload
  );
end;
$$;

revoke all on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function private.crew_apply(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  to service_role;

-- Flags tray includes the first new upsell id so office can approve same day.
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
        'enhancement_id', enhancement_id,
        'same_day_approved_until', same_day_approved_until
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
