-- S21: legacy gate_width_in 0 migrates to null (unknown); 0 means No gate afterward.
select plan(4);

select tests.create_user('gate-owner@example.com', 'Gate Owner') as owner \gset
select tests.create_org('Gate Co', 'gate-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Gate Account')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code, gate_width_in)
values (:'org'::uuid, :'acct'::uuid, '12 Gate Ln', 'Springfield', 'IL', '62704', 36)
returning id as prop \gset

-- Simulate a pre-S21 row that stored blank as 0, then apply the migration UPDATE.
update public.properties set gate_width_in = 0 where id = :'prop'::uuid;

select is(
  (select gate_width_in from public.properties where id = :'prop'::uuid),
  0,
  'pre-migration blank stored as 0'
);

update public.properties
set gate_width_in = null
where gate_width_in = 0;

select is(
  (select gate_width_in from public.properties where id = :'prop'::uuid),
  null,
  'migration converts 0 to null (unknown)'
);

-- After migration, an explicit No gate write keeps 0.
update public.properties set gate_width_in = 0 where id = :'prop'::uuid;

select is(
  (select gate_width_in from public.properties where id = :'prop'::uuid),
  0,
  'no gate stores as 0 after migration'
);

update public.properties set gate_width_in = null where id = :'prop'::uuid;

select is(
  (select gate_width_in from public.properties where id = :'prop'::uuid),
  null,
  'unknown stores as null'
);

select * from finish();
