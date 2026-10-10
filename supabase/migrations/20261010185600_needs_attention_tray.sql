-- S06 Needs attention tray (issue #86).
--
-- Bucket definitions (from ticket 86-S06; exclusive, first match wins):
--   flags            completed_after_cancel OR a new enhancement_request
--   needs_reschedule status in (skipped, cant_complete)
--   overdue          open (scheduled/in_progress/paused) with scheduled_date < as_of
--   unassigned       scheduled, no route, scheduled_date null or >= as_of
--
-- Overdue visits are never auto-moved onto a later day. Horizon fill only
-- inserts missing future occurrences; it does not rewrite past open dates.

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
      v.scheduled_date,
      v.status::text as status,
      v.route_id,
      v.completed_after_cancel,
      coalesce(j.title, 'Visit') as title,
      case
        when v.completed_after_cancel
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
    where v.org_id = v_org
      and v.status <> 'cancelled'::public.visit_status
  ),
  items as (
    select
      bucket,
      jsonb_build_object(
        'id', id,
        'scheduled_date', scheduled_date,
        'status', status,
        'title', title
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
