-- An enhancement proposal is a draft quote attached to the agreement.

select plan(5);

select tests.create_user('en-owner@example.com', 'Enhance Owner') as owner \gset
select tests.create_user('en-owner2@example.com', 'Enhance Owner Two') as owner2 \gset
select tests.create_user('en-crew@example.com', 'Enhance Crew') as crew \gset

select tests.create_org('Enhance One', 'enhanceone', :'owner'::uuid) as org \gset
select tests.create_org('Enhance Two', 'enhancetwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Enhance Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '8 Mulch St', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.agreements (org_id, account_id, property_id, kind, start_date)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', '2026-01-01')
returning id as agreement \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.create_agreement_enhancement(:'agreement'::uuid, 'Mulch the beds') as quote \gset
select is(
  (select title from public.agreement_enhancements where agreement_id = :'agreement'::uuid),
  'Mulch the beds',
  'the proposal is attached to the agreement'
);
select is(
  (select title from public.quotes where id = :'quote'::uuid),
  'Mulch the beds',
  'the draft quote uses the enhancement title'
);
select tests.clear_auth();

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  $$ select public.create_agreement_enhancement('00000000-0000-0000-0000-000000000000', 'Mulch') $$,
  '42501',
  'not allowed',
  'crew cannot propose an enhancement'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.agreement_enhancements),
  0::bigint,
  'another company cannot read enhancement proposals'
);
select throws_ok(
  format(
    $$ select public.create_agreement_enhancement(%L, 'Mulch') $$,
    :'agreement'
  ),
  'P0002',
  'agreement not found',
  'another company cannot attach a proposal'
);
select tests.clear_auth();

select * from finish();
