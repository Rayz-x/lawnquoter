select plan(10);

select tests.create_user('qbo-owner@example.com', 'Qbo Owner') as owner \gset
select tests.create_user('qbo-sales@example.com', 'Qbo Sales') as sales \gset
select tests.create_user('qbo-crew@example.com', 'Qbo Crew') as crew \gset
select tests.create_user('qbo-other@example.com', 'Qbo Other') as other \gset
select tests.create_org('Qbo Co', 'qbo-co', :'owner'::uuid) as org \gset
select tests.create_org('Qbo Other Co', 'qbo-other-co', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ insert into public.qbo_connections (org_id, realm_id) values (%L, 'forged') $$, :'org'),
  '42501', null, 'owner cannot write a QuickBooks connection'
);

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
insert into public.qbo_connections (org_id, realm_id) values (:'org'::uuid, 'realm-1');
insert into public.qbo_sync_log (org_id, direction, entity, outcome) values (:'org'::uuid, 'push', 'accounts', 'synced');
insert into public.qbo_conflicts (org_id, local_name, remote_name) values (:'org'::uuid, 'Ada', 'Ada Lawn');

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select realm_id from public.qbo_connections), 'realm-1', 'owner can read the QuickBooks connection');
select is((select count(*) from public.qbo_sync_log), 1::bigint, 'owner can read the sync log');

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is((select count(*) from public.qbo_connections), 0::bigint, 'sales cannot read QuickBooks');
select is((select count(*) from public.qbo_entity_links), 0::bigint, 'sales cannot read QuickBooks links');
select is((select count(*) from public.qbo_conflicts), 0::bigint, 'sales cannot read conflicts');

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is((select count(*) from public.qbo_connections), 0::bigint, 'crew cannot read the QuickBooks connection');
select is((select count(*) from public.qbo_sync_log), 0::bigint, 'crew cannot read the sync log');

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');
select is((select count(*) from public.qbo_connections), 0::bigint, 'another company cannot read this connection');
select throws_ok(
  format($$ insert into public.qbo_entity_links (org_id, local_table, local_id, qbo_entity, qbo_id) values (%L, 'accounts', gen_random_uuid(), 'Customer', '1') $$, :'org'),
  '42501', null, 'another company cannot write a QuickBooks link'
);

select * from finish();
