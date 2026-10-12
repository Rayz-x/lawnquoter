select plan(8);

select tests.create_user('bid-owner@example.com', 'Bid Owner') as owner \gset
select tests.create_user('bid-crew@example.com', 'Bid Crew') as crew \gset
select tests.create_user('bid-other@example.com', 'Bid Other') as other \gset
select tests.create_org('Bid Co', 'bid-co', :'owner'::uuid) as org \gset
select tests.create_org('Other Co', 'bid-other', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, type, name)
values (:'org'::uuid, 'commercial', 'North Portfolio')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '10 Oak', 'Springfield', 'IL', '62702')
returning id as prop \gset

insert into public.bid_packages (org_id, account_id, title, status, due_on, walk_on)
values (:'org'::uuid, :'acct'::uuid, '2027 grounds', 'bidding', '2027-03-01', '2027-02-10')
returning id as pkg \gset

insert into public.bid_sites (org_id, package_id, property_id, measured_sqft)
values (:'org'::uuid, :'pkg'::uuid, :'prop'::uuid, 12000);

insert into public.bid_lines (org_id, package_id, name, unit, unit_price, qty, frequency)
values (:'org'::uuid, :'pkg'::uuid, 'Mow', 'sq ft', 0.01, 12000, 'weekly');

select is(
  (select status::text from public.bid_packages where id = :'pkg'::uuid),
  'bidding',
  'owner stores a bid package'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');

select lives_ok(
  format(
    $$ insert into public.site_walk_notes (org_id, package_id, property_id, body, lat, lng) values (%L, %L, %L, 'Gate on the north side', 39.8, -89.6) $$,
    :'org', :'pkg', :'prop'
  ),
  'crew can pin a site-walk note'
);

select throws_ok(
  format($$ insert into public.bid_packages (org_id, account_id, title) values (%L, %L, 'Nope') $$, :'org', :'acct'),
  '42501',
  null,
  'crew cannot create a bid package'
);

select is(
  (select count(*) from public.takeoff_imports),
  0::bigint,
  'crew cannot read takeoff imports'
);

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');

select is((select count(*) from public.bid_packages), 0::bigint, 'another org cannot see the package');
select is((select count(*) from public.bid_lines), 0::bigint, 'another org cannot see bid lines');
select is((select count(*) from public.site_walk_notes), 0::bigint, 'another org cannot see site-walk notes');

select throws_ok(
  format(
    $$ insert into public.bid_lines (org_id, package_id, name) values (%L, %L, 'Cross') $$,
    :'other_org', :'pkg'
  ),
  '23503',
  null,
  'a line cannot attach a package from another org'
);
