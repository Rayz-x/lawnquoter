select plan(9);

select tests.create_user('measure-owner@example.com', 'Measure Owner') as owner \gset
select tests.create_org('Measure', 'measure', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat')
returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '100 Maple St', 'Springfield', 'IL', '62704')
returning id as prop \gset

select public.measurement_ensure(:'prop'::uuid) as mid \gset
select public.measurement_replace_features(:'mid'::uuid, '[
  {"category":"turf_front","source":"auto","geometry":{"type":"Polygon","coordinates":[[[-89.6500,39.8000],[-89.6500,39.8002],[-89.6497,39.8002],[-89.6497,39.8000],[-89.6500,39.8000]]]}}
]'::jsonb);

select id as fid, area_sqft as derived
from public.measurement_features
where measurement_id = :'mid'::uuid and category = 'turf_front'
\gset

-- A member who can edit the row tries to overwrite the derived square footage.
-- Rejection and a no-op that leaves the derived value are both acceptable.
select format($q$
  do $do$
  declare
    v_rejected boolean := false;
    v_rows int := 0;
  begin
    begin
      update public.measurement_features
        set area_sqft = 1
        where id = %L::uuid;
      get diagnostics v_rows = row_count;
    exception
      when others then
        v_rejected := true;
    end;
    create temporary table direct_area_attempt (rejected boolean, row_count int);
    insert into direct_area_attempt values (v_rejected, v_rows);
  end
  $do$
$q$, :'fid')
\gexec

select ok(
  (select rejected or row_count = 1 from direct_area_attempt),
  'a member direct area update reaches the polygon or is rejected'
);
select is(
  (select area_sqft from public.measurement_features where id = :'fid'::uuid),
  :'derived'::numeric,
  'a member direct area update on a polygon is rejected or keeps the geography-derived value'
);

select lives_ok(
  format($$ select public.measurement_replace_features(%L::uuid, '[
    {"category":"turf_front","source":"traced","area_sqft":1,"geometry":{"type":"Polygon","coordinates":[[[-89.6500,39.8000],[-89.6500,39.8002],[-89.6497,39.8002],[-89.6497,39.8000],[-89.6500,39.8000]]]}}
  ]'::jsonb) $$, :'mid'),
  'replace accepts a polygon that also sends area_sqft'
);
select is(
  (select area_sqft from public.measurement_features
    where measurement_id = :'mid'::uuid and category = 'turf_front'),
  :'derived'::numeric,
  'measurement_replace_features ignores a forged area_sqft sent with a polygon'
);

select id as kept
from public.measurement_features
where measurement_id = :'mid'::uuid
\gset

select throws_ok(
  format($$ select public.measurement_replace_features(%L::uuid, '[
    {"category":"pond","source":"manual","area_sqft":5}
  ]'::jsonb) $$, :'mid'),
  '22P02',
  null,
  'a replace with an invalid category is rejected'
);
select is(
  (select id::text from public.measurement_features where measurement_id = :'mid'::uuid),
  :'kept',
  'a replace with an invalid category keeps the previous features'
);

update public.measurements set status = 'archived' where id = :'mid'::uuid;
select public.measurement_ensure(:'prop'::uuid) as mid2 \gset
select isnt(
  :'mid2'::uuid,
  :'mid'::uuid,
  'measurement_ensure does not return the archived measurement'
);
select is(
  (select status from public.measurements where id = :'mid2'::uuid),
  'draft',
  'measurement_ensure creates a new draft once the only measurement is archived'
);
select is(
  (select status from public.measurements where id = :'mid'::uuid),
  'archived',
  'the archived measurement stays archived'
);

select * from finish();
