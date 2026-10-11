-- L10: convert_lead_request — rollback, lead status, source/UTM, geocode reuse.

select plan(17);

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('s1@example.com', 'Sales One') as sales1 \gset
select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.services (org_id, name, slug, kind, active, sort)
values
  (:'org1'::uuid, 'Mowing', 'mowing', 'mowing', true, 0),
  (:'org1'::uuid, 'Fertilization', 'fert', 'fert', true, 1);

-- Lead with geocode + UTM + services
insert into public.lead_requests (
  org_id, contact_name, phone, email, address_typed,
  address_line1, city, region, postal_code,
  location, geocode_score, services, source,
  utm_source, utm_medium, utm_campaign, status
) values (
  :'org1'::uuid, 'Pat Lead', '+15551234567', 'pat@example.com',
  '100 Maple St, Springfield, IL 62704',
  '100 Maple St', 'Springfield', 'IL', '62704',
  extensions.st_setsrid(extensions.st_makepoint(-89.6501, 39.8001), 4326)::extensions.geography,
  0.92,
  array['mowing', 'Aeration'],
  'Website form',
  'google', 'cpc', 'spring-sale',
  'new'
) returning id as lead1 \gset

-- ---------------------------------------------------------------------------
-- Failure mid-convert rolls back everything
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $$ select public.convert_lead_request(%L::uuid, null, true) $$,
    :'lead1'
  ),
  'P0001',
  'convert_lead_request forced failure',
  'forced failure raises'
);

select is(
  (select count(*) from public.accounts where org_id = :'org1'::uuid and name = 'Pat Lead'),
  0::bigint,
  'rollback: no account after forced failure'
);
select is(
  (select count(*) from public.properties where org_id = :'org1'::uuid),
  0::bigint,
  'rollback: no property after forced failure'
);
select is(
  (select count(*) from public.quotes where org_id = :'org1'::uuid),
  0::bigint,
  'rollback: no quote after forced failure'
);
select is(
  (select account_id from public.lead_requests where id = :'lead1'::uuid),
  null,
  'rollback: lead links unchanged'
);

-- ---------------------------------------------------------------------------
-- Happy path
-- ---------------------------------------------------------------------------
select public.convert_lead_request(:'lead1'::uuid) as conv \gset

select ok((:'conv'::jsonb ->> 'account_id') is not null, 'convert returns account_id');
select ok((:'conv'::jsonb ->> 'property_id') is not null, 'convert returns property_id');
select ok((:'conv'::jsonb ->> 'quote_id') is not null, 'convert returns quote_id');
select is(
  :'conv'::jsonb ->> 'measurement_path',
  '/properties/' || (:'conv'::jsonb ->> 'property_id') || '/measure',
  'measurement path points at property measure'
);

select :'conv'::jsonb ->> 'account_id' as acct \gset
select :'conv'::jsonb ->> 'property_id' as prop \gset
select :'conv'::jsonb ->> 'quote_id' as qid \gset

select is(
  (select status from public.accounts where id = :'acct'::uuid),
  'lead'::public.account_status,
  'converted account status lead'
);
select is(
  (select lead_source from public.accounts where id = :'acct'::uuid),
  'Website form',
  'source copied onto account'
);
select ok(
  (select notes from public.accounts where id = :'acct'::uuid) like '%utm_source=google%',
  'UTM copied onto account notes'
);
select ok(
  (select location is not null from public.properties where id = :'prop'::uuid),
  'geocode reused on property'
);
select ok(
  exists (
    select 1 from public.activities
    where property_id = :'prop'::uuid
      and kind = 'property.geo_enrich_queued'
  ),
  'parcel/footprint enrich queued'
);
select is(
  (select status from public.quotes where id = :'qid'::uuid),
  'draft'::public.quote_status,
  'draft quote created'
);
select ok(
  (
    select count(*) from public.quote_line_items li
    join public.quote_versions v on v.id = li.version_id
    where v.quote_id = :'qid'::uuid
  ) >= 2,
  'suggested lines from requested services'
);

-- Acceptance path: account can become active (S18 automation owns the trigger)
update public.accounts
set status = 'active'
where id = :'acct'::uuid
  and status = 'lead';

select is(
  (select status from public.accounts where id = :'acct'::uuid),
  'active'::public.account_status,
  'account active after acceptance'
);

select * from finish();
