-- Zone count sets the price inputs and the visit duration.
-- Past visits stay put. Crew and another company cannot write the plan.

select plan(6);

select tests.create_user('ir-owner@example.com', 'Irr Owner') as owner \gset
select tests.create_user('ir-owner2@example.com', 'Irr Owner Two') as owner2 \gset
select tests.create_user('ir-sales@example.com', 'Irr Sales') as sales \gset
select tests.create_user('ir-crew@example.com', 'Irr Crew') as crew \gset

select tests.create_org('Irr One', 'irrone', :'owner'::uuid) as org \gset
select tests.create_org('Irr Two', 'irrtwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Irr Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '4 Zone Ln', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.agreements (org_id, account_id, property_id, kind, start_date, status)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', '2026-04-01', 'active')
returning id as agr \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr'::uuid, :'prop'::uuid, 'Irrigation')
returning id as job \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status, budget_minutes
) values (
  :'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid, 0, '2020-06-01', '2020-06-01', 'scheduled', null
) returning id as past_visit \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status, budget_minutes
) values (
  :'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid, 1, '2027-06-01', '2027-06-01', 'scheduled', null
) returning id as next_visit \gset

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select lives_ok(
  format($$ select public.set_agreement_irrigation_plan(%L::uuid, 6, 8, 12) $$, :'agr'),
  'sales can save an irrigation plan'
);
select tests.clear_auth();

select is((select budget_minutes from public.visits where id = :'next_visit'::uuid), 48, 'a future visit lasts 48 minutes');
select is((select budget_minutes from public.visits where id = :'past_visit'::uuid), null, 'a past visit keeps its duration');

insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid, 2, '2027-06-08', '2027-06-08', 'scheduled'
) returning id as later_visit \gset

select is(
  (select budget_minutes from public.visits where id = :'later_visit'::uuid),
  48,
  'a new visit picks up the zone duration'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.set_agreement_irrigation_plan(%L::uuid, 4, 10, 9) $$, :'agr'),
  '42501',
  null,
  'crew cannot save an irrigation plan'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select throws_ok(
  format($$ select public.set_agreement_irrigation_plan(%L::uuid, 4, 10, 9) $$, :'agr'),
  'P0002',
  null,
  'another company cannot save this irrigation plan'
);
select tests.clear_auth();

select * from finish();
