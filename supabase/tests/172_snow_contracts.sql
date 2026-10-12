-- Snow contract terms stay on the agreement. Crew and another company cannot write them.

select plan(6);

select tests.create_user('sn-owner@example.com', 'Snow Owner') as owner \gset
select tests.create_user('sn-owner2@example.com', 'Snow Owner Two') as owner2 \gset
select tests.create_user('sn-sales@example.com', 'Snow Sales') as sales \gset
select tests.create_user('sn-crew@example.com', 'Snow Crew') as crew \gset

select tests.create_org('Snow One', 'snowone', :'owner'::uuid) as org \gset
select tests.create_org('Snow Two', 'snowtwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Snow Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '9 Flake St', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.agreements (org_id, account_id, property_id, kind, start_date, status)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'one_time', '2026-11-01', 'active')
returning id as agr \gset

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select lives_ok(
  format(
    $$ select public.set_agreement_snow_contract(%L::uuid, 'per_inch', 1, 120, '[{"upTo":2,"price":45},{"upTo":null,"price":120}]'::jsonb) $$,
    :'agr'
  ),
  'sales can save a per-inch snow contract'
);
select tests.clear_auth();

select is(
  (select snow_contract from public.agreements where id = :'agr'::uuid),
  'per_inch',
  'the contract type is stored'
);
select is(
  (select trigger_depth_in from public.agreements where id = :'agr'::uuid),
  1::numeric,
  'the trigger depth is stored'
);
select is(
  (select service_kind from public.agreements where id = :'agr'::uuid),
  'snow',
  'the agreement is marked snow'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ select public.set_agreement_snow_contract(%L::uuid, 'per_push', 2, 55, null) $$,
    :'agr'
  ),
  '42501',
  null,
  'crew cannot save a snow contract'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select throws_ok(
  format(
    $$ select public.set_agreement_snow_contract(%L::uuid, 'seasonal_flat', 2, 400, null) $$,
    :'agr'
  ),
  'P0002',
  null,
  'another company cannot save this snow contract'
);
select tests.clear_auth();

select * from finish();
