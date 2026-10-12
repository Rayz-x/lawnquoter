-- Chemical logs: the crew on the stop can write, the office can read,
-- another company and a different crew cannot.

select plan(7);

select tests.create_user('ch-owner@example.com', 'Chem Owner') as owner \gset
select tests.create_user('ch-owner2@example.com', 'Chem Owner Two') as owner2 \gset
select tests.create_user('ch-lead@example.com', 'Chem Lead') as lead \gset
select tests.create_user('ch-other@example.com', 'Chem Other') as other \gset

select tests.create_org('Chem One', 'chemone', :'owner'::uuid) as org \gset
select tests.create_org('Chem Two', 'chemtwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'other'::uuid, 'crew');

select (timezone('America/Chicago', now()))::date as today \gset

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Chem Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '8 Spray St', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Lawn feed')
returning id as job \gset
insert into public.crews (org_id, name) values (:'org'::uuid, 'Chem Crew') returning id as crew_id \gset
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
    $$ insert into public.chemical_applications
         (org_id, visit_id, product, rate, epa_reg_no, temp_f, wind_mph, conditions)
       values (%L, %L, 'Trimec', '1.5 oz / 1000 sq ft', '2217-543', 72, 4, 'Clear') $$,
    :'org', :'visit'
  ),
  'the crew on the stop can log a chemical application'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select count(*) from public.chemical_applications where visit_id = :'visit'::uuid),
  1::bigint,
  'the office can read the chemical log'
);
select tests.clear_auth();

select tests.authenticate_as(:'other'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ insert into public.chemical_applications
         (org_id, visit_id, product, rate, epa_reg_no, temp_f, wind_mph, conditions)
       values (%L, %L, 'Trimec', '1.5 oz', '2217-543', 70, 3, 'Clear') $$,
    :'org', :'visit'
  ),
  '42501',
  null,
  'a crew that is not on the stop cannot log it'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.chemical_applications where visit_id = :'visit'::uuid),
  0::bigint,
  'another company cannot read the chemical log'
);
select throws_ok(
  format(
    $$ insert into public.chemical_applications
         (org_id, visit_id, product, rate, epa_reg_no, temp_f, wind_mph, conditions)
       values (%L, %L, 'Trimec', '1.5 oz', '2217-543', 70, 3, 'Clear') $$,
    :'org', :'visit'
  ),
  '42501',
  null,
  'another company cannot write the chemical log'
);
select tests.clear_auth();

select tests.authenticate_anon();
select throws_ok(
  $$ insert into public.chemical_applications
       (org_id, visit_id, product, rate, epa_reg_no, temp_f, wind_mph)
     values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'X', '1', '1', 70, 0) $$,
  '42501',
  null,
  'anonymous cannot log a chemical application'
);
select tests.clear_auth();

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format(
    $$ update public.chemical_applications set rate = '9 oz' where visit_id = %L $$,
    :'visit'
  ),
  '42501',
  null,
  'a chemical log cannot be edited'
);
select tests.clear_auth();

select * from finish();
