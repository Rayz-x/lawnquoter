select plan(9);

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('s1@example.com', 'Sales One') as sales1 \gset
select tests.create_user('c1@example.com', 'Crew One')  as crew1  \gset
select tests.create_user('o2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Two', 'two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

select is((select count(*) from public.price_lists where org_id = :'org1'::uuid), 1::bigint, 'new org gets a default price list');

insert into public.services (org_id, name, slug, kind)
values (:'org1'::uuid, 'Weekly mow', 'weekly-mow', 'mowing')
returning id as svc \gset

select id as list from public.price_lists where org_id = :'org1'::uuid and status = 'active' \gset

select lives_ok(
  format($$ insert into public.pricing_rules (org_id, price_list_id, service_id, name, rule_type, config)
    values (%L, %L, %L, 'Mow tiers', 'tier_matrix', '{"type":"tier_matrix","quantityKey":"turf_sqft","rows":[{"upTo":5000,"price":40,"hours":0.5,"cost":18}]}') $$,
    :'org1', :'list', :'svc'),
  'owner can add a pricing rule'
);

select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
select is((select count(*) from public.services), 1::bigint, 'sales can read services');
select throws_ok(
  format($$ insert into public.services (org_id, name, slug) values (%L, 'Nope', 'nope') $$, :'org1'),
  '42501',
  null,
  'sales cannot create services'
);

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.pricing_rules), 1::bigint, 'crew can read rules');
select throws_ok(
  format($$ insert into public.materials (org_id, name, unit_cost) values (%L, 'Mulch', 40) $$, :'org1'),
  '42501',
  null,
  'crew cannot add materials'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.services), 0::bigint, 'other org sees no services');
select is((select count(*) from public.pricing_rules), 0::bigint, 'other org sees no rules');
select throws_ok(
  format($$ insert into public.services (org_id, name, slug) values (%L, 'Stolen', 'stolen') $$, :'org1'),
  '42501',
  null,
  'cannot create a service in another org'
);

select * from finish();
