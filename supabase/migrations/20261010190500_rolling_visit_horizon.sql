-- S01: rolling 8–10 week visit horizon, extended nightly.
-- Keeps every active recurring agreement scheduled through org-local today + 70 days.
-- Idempotent on (org_id, agreement_id, occurrence_date). Never recreates touched rows.

create or replace function private.visit_horizon_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 70;
$$;

revoke all on function private.visit_horizon_days() from public, anon, authenticated;
grant execute on function private.visit_horizon_days() to service_role;

-- Nightly: extend every active recurring agreement through org-local today + 70 days.
create or replace function public.extend_visit_horizons()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_total integer := 0;
  v_n integer;
  v_through date;
  v_horizon integer := private.visit_horizon_days();
begin
  -- Nightly cron / service_role have no auth.uid(). Block JWT members.
  if auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for r in
    select a.id, a.org_id
    from public.agreements a
    where a.kind = 'recurring'::public.agreement_kind
      and a.status = 'active'::public.agreement_status
      and a.frequency is not null
    order by a.org_id, a.id
  loop
    -- fill_agreement_visits scopes to private.current_org_id(); stamp the org claim.
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'role', 'service_role',
        'app_metadata', jsonb_build_object('org_id', r.org_id::text)
      )::text,
      true
    );
    perform set_config('request.jwt.claim.role', 'service_role', true);

    v_through := private.org_local_today(r.org_id) + v_horizon;
    v_n := private.fill_agreement_visits(r.id, v_through);
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  return v_total;
end;
$$;

revoke all on function public.extend_visit_horizons() from public, anon, authenticated;
grant execute on function public.extend_visit_horizons() to service_role;

-- Schedule on hosted when pg_cron is available. Local/CI without the extension skip.
do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available; schedule extend_visit_horizons on hosted';
    return;
  end if;

  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be created; schedule extend_visit_horizons on hosted';
    return;
  end;

  if exists (select 1 from cron.job where jobname = 'extend_visit_horizons') then
    perform cron.unschedule(j.jobid)
    from cron.job j
    where j.jobname = 'extend_visit_horizons';
  end if;

  perform cron.schedule(
    'extend_visit_horizons',
    '20 11 * * *',
    $job$select public.extend_visit_horizons()$job$
  );
exception when others then
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$cron$;
