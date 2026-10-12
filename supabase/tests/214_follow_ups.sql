-- Follow-ups: office reads, admins enable the sequence, crew and other companies cannot.

select plan(10);

select has_table('public', 'automations', 'automations exists');
select has_table('public', 'automation_runs', 'automation_runs exists');
select has_table('public', 'tasks', 'tasks exists');

select tests.create_user('fu-owner@example.com', 'Owner') as owner1 \gset
select tests.create_user('fu-sales@example.com', 'Sales') as sales1 \gset
select tests.create_user('fu-crew@example.com', 'Crew') as crew1 \gset
select tests.create_user('fu-owner2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('Follow One', 'follow-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Follow Two', 'follow-two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

insert into public.tasks (org_id, kind, status, title) values (:'org1'::uuid, 'call', 'open', 'Call about quote')
returning id as task1 \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
insert into public.automations (org_id, purpose, active) values (:'org1'::uuid, 'follow_up', true);
select ok((select active from public.automations where org_id = :'org1'::uuid), 'owner can turn follow-ups on');

select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
select is((select count(*) from public.tasks where id = :'task1'::uuid), 1::bigint, 'sales can see the call task');
update public.tasks set status = 'done' where id = :'task1'::uuid;
select is((select status from public.tasks where id = :'task1'::uuid), 'done', 'sales can finish the call task');
select throws_ok(
  format($$ insert into public.tasks (org_id, title) values (%L, 'Nope') $$, :'org1'),
  '42501', null, 'sales cannot invent a call task');

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.tasks where id = :'task1'::uuid), 0::bigint, 'crew cannot see call tasks');

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.automations where org_id = :'org1'::uuid), 0::bigint, 'another company cannot read follow-ups');
select throws_ok(
  format($$ insert into public.automations (org_id, purpose, active) values (%L, 'follow_up', true) $$, :'org1'),
  '42501', null, 'another company cannot enable follow-ups');
