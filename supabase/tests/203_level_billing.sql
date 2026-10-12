select plan(7);

select tests.create_user('level-owner@example.com', 'Level Owner') as owner \gset
select tests.create_user('level-crew@example.com', 'Level Crew') as crew \gset
select tests.create_user('level-other@example.com', 'Level Other') as other \gset
select tests.create_org('Level Co', 'level-co', :'owner'::uuid) as org \gset
select tests.create_org('Level Other Co', 'level-other-co', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Level Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '9 Level Ln', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.agreements (org_id, account_id, property_id, kind, start_date, status)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', '2026-01-01', 'active')
returning id as agr \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select lives_ok(
  format($$ select public.configure_level_billing(%L, 100000, 12) $$, :'agr'),
  'owner can turn on level billing'
);
select public.create_level_invoice(:'agr'::uuid, 2026, 1) as january \gset
select is(
  (select count(*)::integer from public.invoices where agreement_id = :'agr'::uuid and source = 'level'),
  12,
  'saving level billing drafts one invoice for each month'
);
select is(
  (select total_cents from public.invoices where id = :'january'::uuid),
  8333::bigint,
  'first month of 1000 dollars over 12 months is 8333 cents'
);
select public.create_level_invoice(:'agr'::uuid, 2026, 12) as december \gset
select is(
  (select total_cents from public.invoices where id = :'december'::uuid),
  8337::bigint,
  'last month keeps the remainder so the year sums to 1000 dollars'
);
select is(
  public.create_level_invoice(:'agr'::uuid, 2026, 1),
  :'january'::uuid,
  'the same month returns the existing level invoice'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.create_level_invoice(%L, 2026, 2) $$, :'agr'),
  '42501', null, 'crew cannot create a level invoice'
);

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');
select throws_ok(
  format($$ select public.create_level_invoice(%L, 2026, 2) $$, :'agr'),
  'P0002', null, 'another company cannot bill this agreement'
);

select * from finish();
