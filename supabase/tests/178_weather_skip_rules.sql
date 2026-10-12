-- Weather rules skip or push a scheduled day. Crew cannot apply them.

select plan(10);

select tests.create_user('wx-owner@example.com', 'Weather Owner') as owner \gset
select tests.create_user('wx-owner2@example.com', 'Weather Owner Two') as owner2 \gset
select tests.create_user('wx-crew@example.com', 'Weather Crew') as crew \gset

select tests.create_org('Weather One', 'weatherone', :'owner'::uuid) as org \gset
select tests.create_org('Weather Two', 'weathertwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Weather Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '8 Rain St', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Mow')
returning id as job \gset

insert into public.visits (org_id, job_id, property_id, sort, occurrence_date, scheduled_date, status)
values (:'org'::uuid, :'job'::uuid, :'prop'::uuid, 0, '2026-10-16', '2026-10-16', 'scheduled')
returning id as rain_visit \gset
insert into public.visits (org_id, job_id, property_id, sort, occurrence_date, scheduled_date, status)
values (:'org'::uuid, :'job'::uuid, :'prop'::uuid, 0, '2026-10-23', '2026-10-23', 'scheduled')
returning id as snow_visit \gset
insert into public.visits (org_id, job_id, property_id, sort, occurrence_date, scheduled_date, status)
values (:'org'::uuid, :'job'::uuid, :'prop'::uuid, 0, '2026-10-30', '2026-10-30', 'scheduled')
returning id as both_visit \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select lives_ok(
  $$ select public.set_weather_skip_rule('rain', 0.1, 'skip') $$,
  'the office can save a rain skip rule'
);
select is(
  (public.office_apply_weather('2026-10-16', 0.25, 0, 5, 60) ->> 'action'),
  'skip',
  'a quarter inch of rain skips the day'
);
select is(
  (select status::text from public.visits where id = :'rain_visit'::uuid),
  'skipped',
  'the stop is marked skipped for weather'
);

select lives_ok(
  $$ select public.set_weather_skip_rule('snow', 2, 'push') $$,
  'the office can save a snow push rule'
);
select is(
  (public.office_apply_weather('2026-10-23', 0, 3, 5, 60) ->> 'action'),
  'push',
  'three inches of snow pushes the day'
);
select is(
  (select scheduled_date from public.visits where id = :'snow_visit'::uuid),
  '2026-10-26'::date,
  'Friday moves to Monday'
);

select is(
  (public.office_apply_weather('2026-10-30', 0.25, 3, 5, 60) ->> 'action'),
  'skip',
  'rain wins when snow also matches'
);
select is(
  (select status::text || ' ' || scheduled_date::text from public.visits where id = :'both_visit'::uuid),
  'skipped 2026-10-30',
  'the Friday stop is skipped and stays on Friday'
);
select tests.clear_auth();

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  $$ select public.office_apply_weather('2026-10-16', 1, 0, 0, 60) $$,
  '42501',
  'not allowed',
  'crew cannot apply weather'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.weather_skip_rules),
  0::bigint,
  'another company cannot read the weather rules'
);
select tests.clear_auth();

select * from finish();
