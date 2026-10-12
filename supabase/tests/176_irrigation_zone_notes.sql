-- Irrigation zone notes: the crew on the stop can write, the office can read,
-- another company and a different crew cannot.

select plan(7);

select tests.create_user('iz-owner@example.com', 'Irr Owner') as owner \gset
select tests.create_user('iz-owner2@example.com', 'Irr Owner Two') as owner2 \gset
select tests.create_user('iz-lead@example.com', 'Irr Lead') as lead \gset
select tests.create_user('iz-other@example.com', 'Irr Other') as other \gset

select tests.create_org('Irr One', 'irrone', :'owner'::uuid) as org \gset
select tests.create_org('Irr Two', 'irrtwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'other'::uuid, 'crew');

select (timezone('America/Chicago', now()))::date as today \gset

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Irr Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '8 Zone St', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Irrigation check')
returning id as job \gset
insert into public.crews (org_id, name) values (:'org'::uuid, 'Irr Crew') returning id as crew_id \gset
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
    $$ insert into public.irrigation_zone_notes (org_id, visit_id, zone_number, note)
       values (%L, %L, 3, 'head leaking at the curb') $$,
    :'org', :'visit'
  ),
  'the crew on the stop can save a zone note'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select count(*) from public.irrigation_zone_notes where visit_id = :'visit'::uuid),
  1::bigint,
  'the office can read the zone note'
);
select tests.clear_auth();

select tests.authenticate_as(:'other'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ insert into public.irrigation_zone_notes (org_id, visit_id, zone_number, note)
       values (%L, %L, 1, 'dry') $$,
    :'org', :'visit'
  ),
  '42501',
  null,
  'a crew that is not on the stop cannot write a zone note'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.irrigation_zone_notes where visit_id = :'visit'::uuid),
  0::bigint,
  'another company cannot read the zone note'
);
select throws_ok(
  format(
    $$ insert into public.irrigation_zone_notes (org_id, visit_id, zone_number, note)
       values (%L, %L, 1, 'dry') $$,
    :'org', :'visit'
  ),
  '42501',
  null,
  'another company cannot write the zone note'
);
select tests.clear_auth();

select tests.authenticate_anon();
select throws_ok(
  $$ insert into public.irrigation_zone_notes (org_id, visit_id, zone_number, note)
     values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 1, 'dry') $$,
  '42501',
  null,
  'anonymous cannot write a zone note'
);
select tests.clear_auth();

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format($$ update public.irrigation_zone_notes set note = 'fixed' where visit_id = %L $$, :'visit'),
  '42501',
  null,
  'a zone note cannot be edited'
);
select tests.clear_auth();

select * from finish();
