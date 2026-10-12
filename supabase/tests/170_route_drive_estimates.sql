-- Drive-time order: dispatcher can read pins and store an order.
-- Crew, sales, read-only, anon, and another company cannot.

select plan(13);

select tests.create_user('rte-owner@example.com', 'Route Owner') as owner \gset
select tests.create_user('rte-owner2@example.com', 'Route Owner Two') as owner2 \gset
select tests.create_user('rte-dispatch@example.com', 'Route Dispatch') as dispatcher \gset
select tests.create_user('rte-sales@example.com', 'Route Sales') as sales \gset
select tests.create_user('rte-read@example.com', 'Route Read') as reader \gset
select tests.create_user('rte-crew@example.com', 'Route Crew') as crew \gset

select tests.create_org('Route One', 'routeone', :'owner'::uuid) as org \gset
select tests.create_org('Route Two', 'routetwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'reader'::uuid, 'read_only');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select (timezone('America/Chicago', now()))::date as today \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Route Account')
returning id as acct \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code, location
) values (
  :'org'::uuid, :'acct'::uuid, '1 Start St', 'Nashville', 'TN', '37201',
  extensions.st_geogfromtext('SRID=4326;POINT(-87 36)')
) returning id as prop_a \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code, location
) values (
  :'org'::uuid, :'acct'::uuid, '2 North St', 'Nashville', 'TN', '37201',
  extensions.st_geogfromtext('SRID=4326;POINT(-87 36.2)')
) returning id as prop_b \gset

insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop_a'::uuid, 'Start lawn')
returning id as job_a \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop_b'::uuid, 'North lawn')
returning id as job_b \gset

insert into public.crews (org_id, name)
values (:'org'::uuid, 'Route Crew')
returning id as crew_id \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew_id'::uuid, :'crew'::uuid);

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_id'::uuid, :'today'::date, 'draft')
returning id as route \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_a'::uuid, :'prop_a'::uuid, :'route'::uuid, 0,
  :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_a \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_b'::uuid, :'prop_b'::uuid, :'route'::uuid, 1,
  :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_b \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');

select is(
  (select lat from public.route_stop_points(:'route'::uuid) where visit_id = :'visit_a'::uuid),
  36::double precision,
  'dispatcher reads the start latitude'
);

select is(
  (select lng from public.route_stop_points(:'route'::uuid) where visit_id = :'visit_a'::uuid),
  -87::double precision,
  'dispatcher reads the start longitude'
);

select lives_ok(
  format(
    $sql$ select public.apply_optimized_route(%L::uuid, array[%L, %L]::uuid[], array[0, 12], 'heuristic') $sql$,
    :'route', :'visit_b', :'visit_a'
  ),
  'dispatcher stores a drive-time order'
);

select tests.clear_auth();

select is(
  (select sort from public.visits where id = :'visit_b'::uuid),
  0,
  'the first optimized stop is sort 0'
);
select is(
  (select drive_minutes from public.visits where id = :'visit_a'::uuid),
  12,
  'the second stop keeps its drive minutes'
);
select is(
  (select optimizer from public.routes where id = :'route'::uuid),
  'heuristic',
  'the route records the free estimate'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format(
    $sql$ select public.reorder_route_visits(%L::uuid, array[%L, %L]::uuid[]) $sql$,
    :'route', :'visit_a', :'visit_b'
  ),
  'dispatcher can still reorder by hand'
);
select tests.clear_auth();

select is(
  (select drive_minutes from public.visits where id = :'visit_b'::uuid),
  null,
  'a hand reorder clears the stored drive time'
);
select is(
  (select optimizer from public.routes where id = :'route'::uuid),
  null,
  'a hand reorder clears the optimizer mark'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($sql$ select * from public.route_stop_points(%L::uuid) $sql$, :'route'),
  '42501',
  null,
  'crew cannot read route pins for ordering'
);
select tests.clear_auth();

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select throws_ok(
  format(
    $sql$ select public.apply_optimized_route(%L::uuid, array[%L, %L]::uuid[], array[0, 4], 'api') $sql$,
    :'route', :'visit_a', :'visit_b'
  ),
  '42501',
  null,
  'sales cannot store a drive-time order'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select throws_ok(
  format($sql$ select * from public.route_stop_points(%L::uuid) $sql$, :'route'),
  'P0002',
  null,
  'another company cannot read this route'
);
select tests.clear_auth();

select tests.authenticate_anon();
select throws_ok(
  format($sql$ select * from public.route_stop_points(%L::uuid) $sql$, :'route'),
  '42501',
  null,
  'anonymous cannot read route pins'
);
select tests.clear_auth();

select * from finish();
