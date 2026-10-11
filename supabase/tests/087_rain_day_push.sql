-- S04: rain day action (office_rain_day_push).
-- Spec: internal/tickets/is-wave2/S04_08f8.md

select plan(18);

select ok(
  not has_function_privilege('anon', 'public.office_rain_day_push(date, uuid, uuid[])', 'execute'),
  'anon has no execute on office_rain_day_push'
);
select ok(
  has_function_privilege('authenticated', 'public.office_rain_day_push(date, uuid, uuid[])', 'execute'),
  'authenticated can execute office_rain_day_push'
);

select tests.create_user('rain-owner@example.com', 'Rain Owner') as owner \gset
select tests.create_user('rain-dispatch@example.com', 'Rain Dispatch') as dispatcher \gset
select tests.create_user('rain-crew@example.com', 'Rain Crew') as crew_user \gset
select tests.create_org('Rain Co', 'rain-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'crew_user'::uuid, 'crew');

update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;

-- Anchor Friday so Friday → Monday is deterministic.
select d::date as friday
from generate_series(
  private.org_local_today(:'org'::uuid),
  private.org_local_today(:'org'::uuid) + 6,
  '1 day'::interval
) as d
where extract(dow from d::date) = 5
limit 1
\gset

select (:'friday'::date + 3) as monday \gset
select (:'friday'::date + 7) as next_friday \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Rain Account')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Rain St', 'Chicago', 'IL', '60601')
returning id as prop \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '2 Rain St', 'Chicago', 'IL', '60601')
returning id as prop_b \gset

insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly',
  5, :'friday'::date - 14, 'active'
) returning id as agr \gset

insert into public.jobs (org_id, agreement_id, property_id, title, status)
values (:'org'::uuid, :'agr'::uuid, :'prop'::uuid, 'Friday mow', 'scheduled')
returning id as job \gset

insert into public.crews (org_id, name) values (:'org'::uuid, 'Truck Rain')
returning id as crew_id \gset

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_id'::uuid, :'friday'::date, 'published')
returning id as route_fri \gset

-- This Friday's visit (to push) and next Friday's regular visit.
insert into public.visits (
  org_id, agreement_id, job_id, property_id, route_id, sort,
  occurrence_date, scheduled_date, status, crew_size, budget_minutes
) values (
  :'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid, :'route_fri'::uuid, 0,
  :'friday'::date, :'friday'::date, 'scheduled', 1, 30
) returning id as visit_push \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, route_id, sort,
  occurrence_date, scheduled_date, status, crew_size, budget_minutes
) values (
  :'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid, null, 0,
  :'next_friday'::date, :'next_friday'::date, 'scheduled', 1, 30
) returning id as visit_next \gset

-- Second property on Friday: in-progress must stay put.
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop_b'::uuid, 'recurring', 'weekly',
  5, :'friday'::date - 14, 'active'
) returning id as agr_b \gset

insert into public.jobs (org_id, agreement_id, property_id, title, status)
values (:'org'::uuid, :'agr_b'::uuid, :'prop_b'::uuid, 'In progress mow', 'in_progress')
returning id as job_b \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, route_id, sort,
  occurrence_date, scheduled_date, status, started_at, crew_size, budget_minutes
) values (
  :'org'::uuid, :'agr_b'::uuid, :'job_b'::uuid, :'prop_b'::uuid, :'route_fri'::uuid, 1,
  :'friday'::date, :'friday'::date, 'in_progress', now(), 1, 30
) returning id as visit_ip \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');

-- ---------------------------------------------------------------------------
-- Friday → Monday (Saturday off by default)
-- ---------------------------------------------------------------------------
select public.office_rain_day_push(:'friday'::date, :'crew_id'::uuid, null) as rain_result \gset

select is(
  (select scheduled_date from public.visits where id = :'visit_push'::uuid),
  :'monday'::date,
  'Friday push lands on Monday when Saturday is off'
);
select is(
  (select occurrence_date from public.visits where id = :'visit_push'::uuid),
  :'friday'::date,
  'pushed visit keeps its occurrence identity'
);
select is(
  (select id from public.visits where id = :'visit_push'::uuid),
  :'visit_push'::uuid,
  'pushed visit keeps the same row id'
);
select is(
  (select scheduled_date from public.visits where id = :'visit_ip'::uuid),
  :'friday'::date,
  'in-progress visit is untouched'
);
select is(
  (select status from public.visits where id = :'visit_ip'::uuid),
  'in_progress',
  'in-progress status is untouched'
);
select is(
  (select scheduled_date from public.visits where id = :'visit_next'::uuid),
  :'next_friday'::date,
  'next regular visit is not cascaded'
);

-- ---------------------------------------------------------------------------
-- Collision → skip not double
-- ---------------------------------------------------------------------------
-- Reset push visit back to a fresh Friday and put next regular on Monday.
select tests.clear_auth();
update public.visits
set status = 'scheduled',
    skip_reason = null,
    scheduled_date = :'friday'::date,
    route_id = :'route_fri'::uuid,
    sort = 0
where id = :'visit_push'::uuid;

update public.visits
set occurrence_date = :'monday'::date,
    scheduled_date = :'monday'::date
where id = :'visit_next'::uuid;

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.office_rain_day_push(
  :'friday'::date,
  :'crew_id'::uuid,
  array[:'visit_push'::uuid]::uuid[]
) as rain_collision \gset

select is(
  (select status from public.visits where id = :'visit_push'::uuid),
  'skipped',
  'collision with next regular visit skips the rain push'
);
select is(
  (select skip_reason::text from public.visits where id = :'visit_push'::uuid),
  'weather',
  'collision skip uses weather reason'
);
select is(
  (select scheduled_date from public.visits where id = :'visit_push'::uuid),
  :'friday'::date,
  'skipped collision visit is not moved onto the next workday'
);
select is(
  (
    select count(*)::integer
    from public.visits
    where property_id = :'prop'::uuid
      and scheduled_date = :'monday'::date
      and status = 'scheduled'
  ),
  1,
  'collision does not double-book the property on Monday'
);
select is(
  (select scheduled_date from public.visits where id = :'visit_next'::uuid),
  :'monday'::date,
  'the next regular visit stays on Monday (no cascade)'
);

-- ---------------------------------------------------------------------------
-- Nightly extension after a successful push creates no duplicate
-- ---------------------------------------------------------------------------
select tests.clear_auth();
update public.visits
set status = 'scheduled',
    skip_reason = null,
    occurrence_date = :'friday'::date,
    scheduled_date = :'monday'::date,
    route_id = null
where id = :'visit_push'::uuid;

-- Restore next Friday occurrence for horizon fill uniqueness.
update public.visits
set occurrence_date = :'next_friday'::date,
    scheduled_date = :'next_friday'::date,
    status = 'scheduled',
    skip_reason = null
where id = :'visit_next'::uuid;

select set_config('role', 'service_role', true);
select public.extend_visit_horizons() as after_push \gset

select is(
  (
    select count(*)::integer
    from public.visits
    where agreement_id = :'agr'::uuid
      and occurrence_date = :'friday'::date
  ),
  1,
  'nightly extension after push creates no duplicate occurrence'
);
select is(
  (select scheduled_date from public.visits where id = :'visit_push'::uuid),
  :'monday'::date,
  'pushed visit keeps its moved scheduled date after extension'
);
select is(
  (select id from public.visits where agreement_id = :'agr'::uuid and occurrence_date = :'friday'::date),
  :'visit_push'::uuid,
  'pushed visit identity survives nightly extension'
);

-- ---------------------------------------------------------------------------
-- Saturday workday: Friday → Saturday
-- ---------------------------------------------------------------------------
select tests.clear_auth();
update public.orgs
set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{saturday_workday}', 'true'::jsonb)
where id = :'org'::uuid;

update public.visits
set status = 'scheduled',
    skip_reason = null,
    occurrence_date = :'friday'::date,
    scheduled_date = :'friday'::date,
    route_id = :'route_fri'::uuid
where id = :'visit_push'::uuid;

-- Move next regular off Saturday so this asserts the workday, not collision.
update public.visits
set occurrence_date = :'next_friday'::date,
    scheduled_date = :'next_friday'::date
where id = :'visit_next'::uuid;

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.office_rain_day_push(
  :'friday'::date,
  :'crew_id'::uuid,
  array[:'visit_push'::uuid]::uuid[]
) as rain_sat \gset

select is(
  (select scheduled_date from public.visits where id = :'visit_push'::uuid),
  (:'friday'::date + 1),
  'Friday push lands on Saturday when Saturday is a workday'
);

select tests.authenticate_as(:'crew_user'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.office_rain_day_push(%L::date, null, null) $$, :'friday'),
  '42501',
  null,
  'crew cannot run rain day push'
);

select * from finish();
