-- Site checks are created on acceptance of flagged selected lines, never on send.
-- An open customer request is reused instead of duplicated.

select plan(12);

select tests.create_user('sc-owner@example.com', 'Site Check Owner') as owner \gset
select tests.create_org('Site Check Co', 'site-check-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Pat')
returning id as acct \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org'::uuid, :'acct'::uuid, '1 Main', 'Springfield', 'IL', '62704'
) returning id as prop \gset

-- Flagged line on a sent quote: send creates no site_checks row.
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Flagged send') as sq \gset
select public.quote_current_version(:'sq'::uuid) as svid \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high, site_check_reasons
) values (
  :'org'::uuid, :'svid'::uuid, 'Mulch beds', 'included', 296, 261, 349, array['low_confidence']
) returning id as slid \gset
select public.quote_send(:'sq'::uuid) as stok \gset

select is(
  (select count(*) from public.site_checks where quote_id = :'sq'::uuid),
  0::bigint,
  'sending a flagged quote creates no site check'
);
select ok(
  (select site_check_status is null from public.quotes where id = :'sq'::uuid),
  'send leaves quotes.site_check_status null'
);

-- Accept the flagged selection → one acceptance-origin site check.
select tests.authenticate_anon();
select ok(
  (public.quote_accept(:'stok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua') ->> 'ok') = 'true',
  'accepting a flagged quote succeeds'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select is(
  (select count(*) from public.site_checks where quote_id = :'sq'::uuid),
  1::bigint,
  'accepting creates exactly one site check'
);
select is(
  (
    select origin::text
    from public.site_checks
    where quote_id = :'sq'::uuid
  ),
  'acceptance',
  'the site check origin is acceptance'
);
select is(
  (
    select status::text
    from public.site_checks
    where quote_id = :'sq'::uuid
  ),
  'open',
  'the site check opens on acceptance'
);
select is(
  (
    select site_check_status::text
    from public.quotes
    where id = :'sq'::uuid
  ),
  'open',
  'quotes.site_check_status mirrors the open check'
);
select ok(
  (
    select :'slid'::uuid = any (line_ids)
      and 'low_confidence' = any (reasons)
    from public.site_checks
    where quote_id = :'sq'::uuid
  ),
  'the site check covers the flagged accepted line and its reasons'
);

-- Unselected flagged line does not create a check.
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Optional only') as oq \gset
select public.quote_current_version(:'oq'::uuid) as ovid \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, selected
) values (
  :'org'::uuid, :'ovid'::uuid, 'Firm mow', 'included', 80, true
);
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high, site_check_reasons, selected
) values (
  :'org'::uuid, :'ovid'::uuid, 'Optional mulch', 'optional', 296, 261, 349,
  array['manual'], false
);
select public.quote_send(:'oq'::uuid) as otok \gset
select tests.authenticate_anon();
select public.quote_accept(:'otok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select count(*) from public.site_checks where quote_id = :'oq'::uuid),
  0::bigint,
  'accepting without a selected flagged line creates no site check'
);

-- Open customer request is reused on acceptance (no second row).
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Customer request') as cq \gset
select public.quote_current_version(:'cq'::uuid) as cvid \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high, site_check_reasons
) values (
  :'org'::uuid, :'cvid'::uuid, 'Beds', 'included', 200, 180, 230, array['low_confidence']
) returning id as clid \gset
select public.quote_send(:'cq'::uuid) as ctok \gset

insert into public.site_checks (
  org_id, quote_id, property_id, status, origin, method, reasons, line_ids,
  requested_email, request_note
) values (
  :'org'::uuid, :'cq'::uuid, :'prop'::uuid, 'requested', 'customer_request', 'crew_stop',
  array['customer_request'], array[:'clid'::uuid],
  'pat@example.com', 'side gate locked Mondays'
) returning id as existing_sc \gset

update public.quotes
set site_check_status = 'requested'
where id = :'cq'::uuid;

select tests.authenticate_anon();
select public.quote_accept(:'ctok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select is(
  (select count(*) from public.site_checks where quote_id = :'cq'::uuid),
  1::bigint,
  'accepting reuses the open customer request instead of inserting another'
);
select is(
  (
    select id::text || ':' || status::text || ':' || origin::text
    from public.site_checks
    where quote_id = :'cq'::uuid
  ),
  :'existing_sc' || ':open:customer_request',
  'the reused check opens and keeps customer_request origin'
);
select ok(
  (
    select :'clid'::uuid = any (line_ids)
      and 'low_confidence' = any (reasons)
    from public.site_checks
    where id = :'existing_sc'::uuid
  ),
  'reuse refreshes line_ids and reasons from the accepted selection'
);

select * from finish();
