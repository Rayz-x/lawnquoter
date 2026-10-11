-- Service catalog v1: installer writes only to a draft list, is idempotent by
-- catalog key, flags starter prices (cleared on first edit), and activation
-- carries over existing active rules. Only admins can install or activate.

select plan(16);

select tests.create_user('cat-owner@example.com', 'Cat Owner') as owner \gset
select tests.create_user('cat-crew@example.com', 'Cat Crew') as crew \gset
select tests.create_user('cat-sales@example.com', 'Cat Sales') as sales \gset
select tests.create_org('Catalog Co', 'catalog-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');

select id as active_list from public.price_lists where org_id = :'org'::uuid and status = 'active' \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

-- An existing service priced in the active list (like Weekly Mow).
insert into public.services (org_id, name, slug, kind) values (:'org'::uuid, 'Weekly Mow', 'weekly-mow', 'mowing')
returning id as mow \gset
insert into public.pricing_rules (org_id, price_list_id, service_id, name, rule_type, config)
values (:'org'::uuid, :'active_list'::uuid, :'mow'::uuid, 'Weekly Mow', 'tier_matrix',
  '{"type":"tier_matrix","quantityKey":"turf_sqft","rows":[{"upTo":null,"price":55,"hours":0,"cost":0}]}');

select '[
  {"key":"core-aeration","version":"2026-10-11","name":"Core aeration","kind":"other","description":"Aerate","crew_task_name":"Core aerate","taxable":false,"is_material":false,"window_start":"2026-09-01","window_end":"2026-10-31","warn_date":"2026-10-17",
   "config":{"type":"tier_matrix","quantityKey":"turf_sqft","rows":[{"upTo":1000,"price":17,"hours":0,"cost":0}],"tail":{"every":1000,"over":1000,"addPrice":17,"addHours":0,"addCost":0}}},
  {"key":"mulch-installation","version":"2026-10-11","name":"Mulch installation","kind":"install","is_material":true,
   "config":{"type":"tier_matrix","quantityKey":"bed_sqft","rows":[{"upTo":162,"price":85.5,"hours":0,"cost":0}],"tail":{"every":162,"over":162,"addPrice":85.5,"addHours":0,"addCost":0}}}
]' as entries \gset

select public.install_catalog_services(:'entries'::jsonb) ->> 'installed' as installed \gset
select is(:'installed', '2', 'owner installs two catalog services');

select id as draft from public.price_lists where org_id = :'org'::uuid and status = 'draft' \gset
select isnt(:'draft', :'active_list', 'catalog rules go to a separate draft list');

select is(
  (select count(*) from public.pricing_rules r join public.services s on s.id = r.service_id
    where s.catalog_key is not null and r.price_list_id = :'active_list'::uuid),
  0::bigint,
  'the active price list is untouched'
);

select is(
  (select count(*) from public.pricing_rules where price_list_id = :'draft'::uuid and starter_price),
  2::bigint,
  'installed rules are flagged as starter prices'
);

select ok(
  (select is_material and not taxable and catalog_version = '2026-10-11'
     from public.services where org_id = :'org'::uuid and catalog_key = 'mulch-installation'),
  'material flag, tax default, and catalog version are recorded'
);

select is(
  (select window_start from public.services where org_id = :'org'::uuid and catalog_key = 'core-aeration'),
  '2026-09-01'::date,
  'season window start is stored'
);

select is(
  public.install_catalog_services(:'entries'::jsonb) ->> 'skipped',
  '2',
  'installing the same catalog keys again skips them'
);

select is(
  (select count(*) from public.services where org_id = :'org'::uuid and catalog_key is not null),
  2::bigint,
  'no duplicate services after a re-run'
);

-- First edit clears the starter flag.
update public.pricing_rules
set config = jsonb_set(config, '{rows,0,price}', '20')
where price_list_id = :'draft'::uuid and name = 'Core aeration';
select is(
  (select starter_price from public.pricing_rules where price_list_id = :'draft'::uuid and name = 'Core aeration'),
  false,
  'editing a starter rule clears its starter flag'
);
select is(
  (select starter_price from public.pricing_rules where price_list_id = :'draft'::uuid and name = 'Mulch installation'),
  true,
  'an unedited rule keeps its starter flag'
);

-- Non-admins cannot install or activate.
select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select throws_ok(
  format('select public.install_catalog_services(%L::jsonb)', :'entries'),
  '42501', 'not allowed', 'sales cannot install catalog services'
);
select throws_ok(
  format('select public.activate_price_list(%L::uuid)', :'draft'),
  '42501', 'not allowed', 'sales cannot activate a price list'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from public.pricing_rules where price_list_id = :'draft'::uuid),
  0::bigint,
  'crew cannot read catalog prices'
);

-- Activation.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.activate_price_list(:'draft'::uuid);

select is(
  (select status::text from public.price_lists where id = :'draft'::uuid) || '/' ||
  (select status::text from public.price_lists where id = :'active_list'::uuid),
  'active/archived',
  'activation makes the draft active and archives the old list'
);

select is(
  (select count(*) from public.pricing_rules where price_list_id = :'draft'::uuid and service_id = :'mow'::uuid),
  1::bigint,
  'existing services keep their prices in the new active list'
);

select throws_ok(
  format('select public.activate_price_list(%L::uuid)', :'draft'),
  '22023', 'only a draft price list can be activated', 'an active list cannot be activated again'
);

select * from finish();
