-- A locked Friday visit moves to the next Friday. An unlocked visit moves to Monday.
-- A different weekday is refused. Crew and another company cannot set the lock.

select plan(8);

select tests.create_user('fix-owner@example.com', 'Fix Owner') as owner \gset
select tests.create_user('fix-owner2@example.com', 'Fix Owner Two') as owner2 \gset
select tests.create_user('fix-dispatch@example.com', 'Fix Dispatch') as dispatcher \gset
select tests.create_user('fix-crew@example.com', 'Fix Crew') as crew \gset

select tests.create_org('Fix One', 'fixone', :'owner'::uuid) as org \gset
select tests.create_org('Fix Two', 'fixtwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Fix Account')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Friday Ln', 'Nashville', 'TN', '37201')
returning id as prop_fixed \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '2 Open Ln', 'Nashville', 'TN', '37201')
returning id as prop_open \gset

insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status, fixed_route_day
) values (
  :'org'::uuid, :'acct'::uuid, :'prop_fixed'::uuid, 'recurring', 'weekly',
  5, '2026-10-02', 'active', true
) returning id as agr_fixed \gset

insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop_open'::uuid, 'recurring', 'weekly',
  5, '2026-10-02', 'active'
) returning id as agr_open \gset

insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_fixed'::uuid, :'prop_fixed'::uuid, 'Locked Friday')
returning id as job_fixed \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_open'::uuid, :'prop_open'::uuid, 'Open Friday')
returning id as job_open \gset

insert into public.crews (org_id, name)
values (:'org'::uuid, 'Fix Crew')
returning id as crew_id \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew_id'::uuid, :'crew'::uuid);

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_id'::uuid, '2026-10-16', 'published')
returning id as route \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr_fixed'::uuid, :'job_fixed'::uuid, :'prop_fixed'::uuid, :'route'::uuid,
  0, '2026-10-16', '2026-10-16', 'scheduled'
) returning id as visit_fixed \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr_open'::uuid, :'job_open'::uuid, :'prop_open'::uuid, :'route'::uuid,
  1, '2026-10-16', '2026-10-16', 'scheduled'
) returning id as visit_open \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.office_rain_day_push('2026-10-16'::date, null, null);
select tests.clear_auth();

select is(
  (select scheduled_date from public.visits where id = :'visit_fixed'::uuid),
  '2026-10-23'::date,
  'a locked Friday visit moves to the next Friday'
);
select is(
  (select scheduled_date from public.visits where id = :'visit_open'::uuid),
  '2026-10-19'::date,
  'an unlocked visit still moves to the next workday'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format(
    $$ select public.assign_visit(%L::uuid, %L::uuid, '2026-10-20'::date, 0) $$,
    :'visit_fixed', :'crew_id'
  ),
  '23514',
  'This visit stays on its route day',
  'a locked visit cannot move to a different weekday'
);
select lives_ok(
  format($$ select public.set_agreement_fixed_route_day(%L::uuid, false) $$, :'agr_fixed'),
  'dispatcher can unlock the route day'
);
select tests.clear_auth();

select is(
  (select fixed_route_day from public.agreements where id = :'agr_fixed'::uuid),
  false,
  'the lock is stored on the agreement'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.set_agreement_fixed_route_day(%L::uuid, true) $$, :'agr_fixed'),
  '42501',
  null,
  'crew cannot lock a route day'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select throws_ok(
  format($$ select public.set_agreement_fixed_route_day(%L::uuid, true) $$, :'agr_fixed'),
  'P0002',
  null,
  'another company cannot lock this agreement'
);
select tests.clear_auth();

select tests.authenticate_anon();
select throws_ok(
  format($$ select public.set_agreement_fixed_route_day(%L::uuid, true) $$, :'agr_fixed'),
  '42501',
  null,
  'anonymous cannot lock a route day'
);
select tests.clear_auth();

select * from finish();
