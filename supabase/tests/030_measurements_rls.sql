select plan(12);

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('c1@example.com', 'Crew One')  as crew1  \gset
select tests.create_user('o2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Two', 'two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.accounts (org_id, name) values (:'org1'::uuid, 'Pat')
returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org1'::uuid, :'acct'::uuid, '100 Maple St', 'Springfield', 'IL', '62704')
returning id as prop1 \gset

select public.measurement_ensure(:'prop1'::uuid) as mid \gset

select ok(:'mid'::uuid is not null, 'measurement_ensure creates a draft');
select is(
  public.measurement_ensure(:'prop1'::uuid),
  :'mid'::uuid,
  'measurement_ensure is idempotent'
);

select lives_ok(
  format($$ select public.measurement_replace_features(%L::uuid, '[
    {"category":"turf_front","source":"auto","geometry":{"type":"Polygon","coordinates":[[[-89.6500,39.8000],[-89.6500,39.8002],[-89.6497,39.8002],[-89.6497,39.8000],[-89.6500,39.8000]]]}},
    {"category":"edging_line","source":"traced","geometry":{"type":"LineString","coordinates":[[-89.6500,39.8000],[-89.6497,39.8000]]}},
    {"category":"bed","source":"manual","area_sqft":120}
  ]'::jsonb) $$, :'mid'),
  'owner can replace features'
);

select ok(
  (select area_sqft > 100 from public.measurement_features
    where measurement_id = :'mid'::uuid and category = 'turf_front'),
  'area derived from polygon geography'
);
select ok(
  (select length_ft > 80 from public.measurement_features
    where measurement_id = :'mid'::uuid and category = 'edging_line'),
  'length derived from linestring geography'
);
select is(
  (select area_sqft from public.measurement_features
    where measurement_id = :'mid'::uuid and category = 'bed'),
  120::numeric,
  'manual feature keeps entered square footage'
);

update public.measurements set status = 'current', confidence = 0.72 where id = :'mid'::uuid;
select throws_ok(
  format($$ insert into public.measurements (org_id, property_id, status) values (%L, %L, 'current') $$, :'org1', :'prop1'),
  '23505',
  null,
  'only one current measurement per property'
);

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.measurements), 1::bigint, 'crew can read measurements');
select throws_ok(
  format($$ select public.measurement_replace_features(%L::uuid, '[]'::jsonb) $$, :'mid'),
  '42501',
  null,
  'crew cannot replace features'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.measurements), 0::bigint, 'other org sees no measurements');
select is(public.measurement_features_geojson(:'mid'::uuid), '[]'::jsonb, 'other org cannot read features via RPC');
select throws_ok(
  format($$ select public.measurement_replace_features(%L::uuid, '[]'::jsonb) $$, :'mid'),
  'P0002',
  null,
  'other org cannot replace features of a hidden measurement'
);

select * from finish();
