-- A 5 percent rule turns a $400 season into a $420 renewal quote.

select plan(6);

select tests.create_user('rn-owner@example.com', 'Renew Owner') as owner \gset
select tests.create_user('rn-owner2@example.com', 'Renew Owner Two') as owner2 \gset
select tests.create_user('rn-crew@example.com', 'Renew Crew') as crew \gset

select tests.create_org('Renew One', 'renewone', :'owner'::uuid) as org \gset
select tests.create_org('Renew Two', 'renewtwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Renew Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '8 Renew St', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.agreements (org_id, account_id, property_id, kind, start_date, end_date)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', '2026-01-01', '2026-10-22')
returning id as agreement \gset
insert into public.agreement_price_terms (org_id, agreement_id, season_price_cents, effective_from)
values (:'org'::uuid, :'agreement'::uuid, 40000, '2026-01-01');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select lives_ok(
  $$ select public.set_renewal_rule(5, 30) $$,
  'the office can save a 5 percent increase'
);
select public.propose_agreement_renewal(:'agreement'::uuid) as quote \gset
select is(
  (select prior_cents::text || ' ' || proposed_cents::text from public.renewal_proposals where agreement_id = :'agreement'::uuid),
  '40000 42000',
  'a $400 season at 5 percent is proposed at $420'
);
select is(
  (select price from public.quote_line_items li
    join public.quote_versions v on v.id = li.version_id
    where v.quote_id = :'quote'::uuid),
  420::numeric,
  'the draft quote line is $420'
);
select tests.clear_auth();

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  $$ select public.propose_agreement_renewal('00000000-0000-0000-0000-000000000000') $$,
  '42501',
  'not allowed',
  'crew cannot propose a renewal'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.renewal_proposals),
  0::bigint,
  'another company cannot read renewal proposals'
);
select is(
  (select count(*) from public.renewal_rules),
  0::bigint,
  'another company cannot read the price increase'
);
select tests.clear_auth();

select * from finish();
