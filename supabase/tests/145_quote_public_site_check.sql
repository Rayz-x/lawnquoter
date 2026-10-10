-- quote_public exposes site-check fields for customer copy (no prices to crew).

select plan(5);

select tests.create_user('pub-sc@example.com', 'Pub SC') as owner \gset
select tests.create_org('Pub SC Co', 'pub-sc-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset
select public.quote_create(:'acct'::uuid, null, 'Public site check') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high, site_check_reasons
) values (
  :'org'::uuid, :'vid'::uuid, 'Mulch', 'included', 296, 261, 349, array['low_confidence', 'canopy']
);
select public.quote_send(:'qid'::uuid) as tok \gset
update public.quotes set site_check_status = 'open' where id = :'qid'::uuid;

select tests.authenticate_anon();
select is(
  public.quote_public(:'tok'::uuid) ->> 'site_check_status',
  'open',
  'quote_public returns site_check_status'
);
select ok(
  public.quote_public(:'tok'::uuid) #>> '{items,0,site_check_reasons,0}' = 'low_confidence',
  'quote_public returns site_check_reasons on items'
);
select ok(
  public.quote_public(:'tok'::uuid) #>> '{items,0,site_check_reasons,1}' = 'canopy',
  'quote_public returns every reason code'
);
select ok(
  (public.quote_public(:'tok'::uuid) -> 'items' -> 0) ? 'verified_price'
  and (public.quote_public(:'tok'::uuid) -> 'items' -> 0) ? 'verified_at',
  'quote_public includes verified_price and verified_at keys'
);
select ok(
  (public.quote_public(:'tok'::uuid) -> 'items' -> 0 ->> 'price')::numeric = 296,
  'public items still include the point price for the estimate'
);

select * from finish();
