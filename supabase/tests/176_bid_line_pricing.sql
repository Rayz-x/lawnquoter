-- Crew can walk a bid package and cannot read its unit prices.

select plan(4);

select tests.create_user('price-owner@example.com', 'Price Owner') as owner \gset
select tests.create_user('price-crew@example.com', 'Price Crew') as crew \gset
select tests.create_user('price-reader@example.com', 'Price Reader') as reader \gset
select tests.create_org('Price Co', 'price-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'reader'::uuid, 'read_only');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, type, name)
values (:'org'::uuid, 'commercial', 'North')
returning id as acct \gset

insert into public.bid_packages (org_id, account_id, title)
values (:'org'::uuid, :'acct'::uuid, '2027 grounds')
returning id as pkg \gset

insert into public.bid_lines (org_id, package_id, name, unit_price)
values (:'org'::uuid, :'pkg'::uuid, 'Mow', 0.02);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');

select is(
  (select count(*) from public.bid_packages),
  1::bigint,
  'crew can see the bid package they walk'
);

select is(
  (select count(*) from public.bid_lines),
  0::bigint,
  'crew cannot read bid line prices'
);

select tests.authenticate_as(:'reader'::uuid, :'org'::uuid, 'read_only');

select ok(
  (select unit_price = 0.02 from public.bid_lines),
  'office read only can see bid line prices'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select is(
  (select count(*) from public.bid_lines),
  1::bigint,
  'owner can see bid line prices'
);
