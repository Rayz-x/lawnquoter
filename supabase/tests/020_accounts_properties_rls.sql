select plan(19);

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('c1@example.com', 'Crew One')  as crew1  \gset
select tests.create_user('o2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Two', 'two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

-- Owner creates a commercial parent + child account and a property ----------
select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.accounts (org_id, type, name, status, net_terms_days, po_required)
values (:'org1'::uuid, 'commercial', 'Maple HOA', 'active', 30, true)
returning id as parent_acct \gset

select lives_ok(
  format($$ insert into public.accounts (org_id, type, name, parent_account_id) values (%L, 'commercial', 'Maple HOA - Phase 2', %L) $$, :'org1', :'parent_acct'),
  'child account under a parent in the same org'
);

select throws_ok(
  format($$ insert into public.accounts (org_id, type, name) values (%L, 'commercial', 'Bad account') $$, :'org2'),
  '42501',
  null,
  'cannot create an account in another org (RLS)'
);
select throws_ok(
  format($$ insert into public.accounts (org_id, type, name, parent_account_id) values (%L, 'commercial', 'Bad child', %L) $$, :'org2', :'parent_acct'),
  '23503',
  null,
  'cross-org parent is rejected by the integrity trigger'
);

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org1'::uuid, :'parent_acct'::uuid, '100 Maple St', 'Springfield', 'IL', '62704')
returning id as prop1 \gset

select is(
  (select formatted_address from public.properties where id = :'prop1'::uuid),
  '100 Maple St, Springfield, IL 62704',
  'formatted address is derived'
);

-- Geometry via RPC; lot area derived -------------------------------------------
select lives_ok(
  format($$ select public.property_set_geometry(
      %L::uuid,
      '{"type":"Point","coordinates":[-89.65,39.80]}'::jsonb,
      '{"type":"Polygon","coordinates":[[[-89.6500,39.8000],[-89.6500,39.8003],[-89.6496,39.8003],[-89.6496,39.8000],[-89.6500,39.8000]]]}'::jsonb,
      'regrid', 'APN-1', null, null, null) $$, :'prop1'),
  'owner can set geometry'
);

-- ~33.3m x ~34.2m lot -> roughly 1,140 sqm -> ~12,270 sqft (tolerance for projection)
select ok(
  (select lot_sqft between 11000 and 13500 from public.properties where id = :'prop1'::uuid),
  'lot_sqft derived from parcel area'
);

select is(
  (select (public.property_geometry(:'prop1'::uuid) -> 'parcel' ->> 'type')),
  'MultiPolygon',
  'parcel returned as MultiPolygon GeoJSON'
);

-- Contacts: one primary per account -------------------------------------------
insert into public.contacts (org_id, account_id, first_name, last_name, email, is_primary)
values (:'org1'::uuid, :'parent_acct'::uuid, 'Pat', 'Manager', 'pat@hoa.test', true);

select throws_ok(
  format($$ insert into public.contacts (org_id, account_id, first_name, is_primary) values (%L, %L, 'Second', true) $$, :'org1', :'parent_acct'),
  '23505',
  null,
  'only one primary contact per account'
);

-- Crew can read but not write ---------------------------------------------------
select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.accounts), 2::bigint, 'crew sees org accounts');
select is((select count(*) from public.properties), 1::bigint, 'crew sees org properties');
select throws_ok(
  format($$ insert into public.accounts (org_id, name) values (%L, 'Crew made this') $$, :'org1'),
  '42501',
  null,
  'crew cannot create accounts'
);
update public.properties set crew_notes = 'x' where id = :'prop1'::uuid;
select tests.clear_auth();
select is((select crew_notes from public.properties where id = :'prop1'::uuid), null, 'crew update is a no-op');
select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select throws_ok(
  format($$ select public.property_clear_geometry(%L::uuid) $$, :'prop1'),
  'P0002',
  null,
  'crew cannot clear property geometry'
);
select tests.clear_auth();

-- Other org sees nothing --------------------------------------------------------
select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.accounts), 0::bigint, 'other org sees no accounts');
select is((select count(*) from public.properties), 0::bigint, 'other org sees no properties');
select is(public.property_geometry(:'prop1'::uuid), null, 'other org cannot read geometry via RPC');

insert into public.accounts (org_id, name) values (:'org2'::uuid, 'Other Co') returning id as other_acct \gset
select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select throws_ok(
  format($$ insert into public.contacts (org_id, account_id, first_name) values (%L, %L, 'Nope') $$, :'org1', :'other_acct'),
  '23503',
  null,
  'contact account must belong to the same org'
);

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
update public.properties
  set place_id = 'match-1', building_sqft = 100
  where id = :'prop1'::uuid;
select lives_ok(
  format($$ select public.property_clear_geometry(%L::uuid) $$, :'prop1'),
  'owner can clear stored geometry'
);
select is(
  (select location is null
      and parcel is null
      and footprint is null
      and place_id is null
      and parcel_apn is null
      and parcel_source = 'unknown'
      and footprint_source = 'unknown'
      and lot_sqft is null
      and building_sqft is null
   from public.properties where id = :'prop1'::uuid),
  true,
  'clear removes the pin, parcel, outline, place id, and derived areas'
);

select * from finish();
