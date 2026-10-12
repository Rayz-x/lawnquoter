-- Two inches against a 2 inch trigger schedules one visit. One inch does not.

select plan(6);

select tests.create_user('sa-owner@example.com', 'Activate Owner') as owner \gset
select tests.create_user('sa-owner2@example.com', 'Activate Owner Two') as owner2 \gset
select tests.create_user('sa-crew@example.com', 'Activate Crew') as crew \gset

select tests.create_org('Activate One', 'activateone', :'owner'::uuid) as org \gset
select tests.create_org('Activate Two', 'activatetwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Activate Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '9 Drift St', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.agreements (org_id, account_id, property_id, kind, start_date, status)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', '2026-11-01', 'active')
returning id as agr \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.set_agreement_snow_contract(:'agr'::uuid, 'per_push', 2, 55, null);
select is(
  public.activate_snow_event('2026-12-01', 1),
  0,
  'one inch under a 2 inch trigger schedules nothing'
);
select is(
  (select count(*) from public.visits where agreement_id = :'agr'::uuid),
  0::bigint,
  'no visit exists under the trigger'
);
select is(
  public.activate_snow_event('2026-12-01', 2),
  1,
  'two inches schedules the snow visit'
);
select is(
  public.activate_snow_event('2026-12-01', 4),
  0,
  'activating the same day again does not add a visit'
);
select tests.clear_auth();

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  $$ select public.activate_snow_event('2026-12-01', 3) $$,
  '42501',
  'not allowed',
  'crew cannot activate a snow event'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.snow_events),
  0::bigint,
  'another company cannot read the snow event'
);
select tests.clear_auth();

select * from finish();
