select plan(4);

select tests.create_user('coord-a@example.com', 'Coord A') as owner_a \gset
select tests.create_user('coord-b@example.com', 'Coord B') as owner_b \gset
select tests.create_org('Coord A', 'coord-a', :'owner_a'::uuid) as org_a \gset
select tests.create_org('Coord B', 'coord-b', :'owner_b'::uuid) as org_b \gset

select tests.authenticate_as(:'owner_a'::uuid, :'org_a'::uuid, 'owner');

insert into public.accounts (org_id, type, name)
values (:'org_a'::uuid, 'residential', 'Coord Home')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org_a'::uuid, :'acct'::uuid, '1 Pine', 'Springfield', 'IL', '62701')
returning id as prop \gset

select lives_ok(
  format($$ select public.property_set_geometry(%L::uuid, '{"type":"Point","coordinates":[-89.65,39.80]}'::jsonb, null, null, null, null, null, null) $$, :'prop'),
  'owner sets a property point'
);

select results_eq(
  format('select lng, lat from public.property_coordinates(array[%L]::uuid[])', :'prop'),
  $$ values (-89.65::double precision, 39.80::double precision) $$,
  'owner reads the property coordinates'
);

select tests.authenticate_as(:'owner_b'::uuid, :'org_b'::uuid, 'owner');

select is(
  (select count(*) from public.property_coordinates(array[:'prop']::uuid[])),
  0::bigint,
  'another org cannot read the point'
);

select ok(
  not has_function_privilege('anon', 'public.property_coordinates(uuid[])', 'execute'),
  'anon cannot execute property_coordinates'
);
