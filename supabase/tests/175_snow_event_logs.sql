-- Snow logs: the crew on the stop can write, the office can read,
-- another company and a different crew cannot.

select plan(7);

select tests.create_user('sn-owner@example.com', 'Snow Owner') as owner \gset
select tests.create_user('sn-owner2@example.com', 'Snow Owner Two') as owner2 \gset
select tests.create_user('sn-lead@example.com', 'Snow Lead') as lead \gset
select tests.create_user('sn-other@example.com', 'Snow Other') as other \gset

select tests.create_org('Snow One', 'snowone', :'owner'::uuid) as org \gset
select tests.create_org('Snow Two', 'snowtwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'other'::uuid, 'crew');

select (timezone('America/Chicago', now()))::date as today \gset

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Snow Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '8 Flake St', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Snow push')
returning id as job \gset
insert into public.crews (org_id, name) values (:'org'::uuid, 'Snow Crew') returning id as crew_id \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew_id'::uuid, :'lead'::uuid);
insert into public.routes (org_id, crew_id, date, status, published_at)
values (:'org'::uuid, :'crew_id'::uuid, :'today'::date, 'published', now())
returning id as route \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job'::uuid, :'prop'::uuid, :'route'::uuid, 0, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit \gset

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select lives_ok(
  format(
    $$ insert into public.snow_event_logs
         (org_id, visit_id, trigger_depth_in, started_at, ended_at, materials)
       values (%L, %L, 2, '2026-01-15 06:00+00', '2026-01-15 09:30+00', 'salt, 2 bags') $$,
    :'org', :'visit'
  ),
  'the crew on the stop can log a snow event'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select count(*) from public.snow_event_logs where visit_id = :'visit'::uuid),
  1::bigint,
  'the office can read the snow log'
);
select tests.clear_auth();

select tests.authenticate_as(:'other'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ insert into public.snow_event_logs
         (org_id, visit_id, trigger_depth_in, started_at, ended_at, materials)
       values (%L, %L, 2, '2026-01-15 06:00+00', '2026-01-15 07:00+00', 'salt') $$,
    :'org', :'visit'
  ),
  '42501',
  null,
  'a crew that is not on the stop cannot log it'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.snow_event_logs where visit_id = :'visit'::uuid),
  0::bigint,
  'another company cannot read the snow log'
);
select throws_ok(
  format(
    $$ insert into public.snow_event_logs
         (org_id, visit_id, trigger_depth_in, started_at, ended_at, materials)
       values (%L, %L, 2, '2026-01-15 06:00+00', '2026-01-15 07:00+00', 'salt') $$,
    :'org', :'visit'
  ),
  '42501',
  null,
  'another company cannot write the snow log'
);
select tests.clear_auth();

select tests.authenticate_anon();
select throws_ok(
  $$ insert into public.snow_event_logs
       (org_id, visit_id, trigger_depth_in, started_at, ended_at, materials)
     values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 1, '2026-01-15 06:00+00', '2026-01-15 07:00+00', 'salt') $$,
  '42501',
  null,
  'anonymous cannot log a snow event'
);
select tests.clear_auth();

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format(
    $$ update public.snow_event_logs set materials = 'sand' where visit_id = %L $$,
    :'visit'
  ),
  '42501',
  null,
  'a snow log cannot be edited'
);
select tests.clear_auth();

select * from finish();
