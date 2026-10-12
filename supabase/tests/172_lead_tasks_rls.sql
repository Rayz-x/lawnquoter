-- lead_tasks: office read, sales write, crew and other orgs denied.

select plan(8);

select tests.create_user('task-owner@example.com', 'Task Owner') as owner1 \gset
select tests.create_user('task-sales@example.com', 'Task Sales') as sales1 \gset
select tests.create_user('task-read@example.com', 'Task Read') as read1 \gset
select tests.create_user('task-crew@example.com', 'Task Crew') as crew1 \gset
select tests.create_user('task-owner2@example.com', 'Task Owner Two') as owner2 \gset
select tests.create_org('Task One', 'task-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Task Two', 'task-two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'read1'::uuid, 'read_only');
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed
) values (
  :'org1'::uuid, 'Ada', '+15551110001', '1 Oak St'
) returning id as lead1 \gset

insert into public.lead_tasks (org_id, lead_request_id, title, due_on)
values (:'org1'::uuid, :'lead1'::uuid, 'Call back', '2026-10-10')
returning id as task1 \gset
select ok(:'task1'::uuid is not null, 'owner can add a task');

select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
select lives_ok(
  format(
    $$ update public.lead_tasks set completed_at = now() where id = %L $$,
    :'task1'
  ),
  'sales can complete a task'
);

select tests.authenticate_as(:'read1'::uuid, :'org1'::uuid, 'read_only');
select is(
  (select count(*) from public.lead_tasks where id = :'task1'::uuid),
  1::bigint,
  'read_only can see tasks'
);
update public.lead_tasks set title = 'nope' where id = :'task1'::uuid;
select tests.clear_auth();
select is(
  (select title from public.lead_tasks where id = :'task1'::uuid),
  'Call back',
  'read_only cannot change a task'
);

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is(
  (select count(*) from public.lead_tasks),
  0::bigint,
  'crew cannot see tasks'
);
select throws_ok(
  format(
    $$ insert into public.lead_tasks (org_id, lead_request_id, title)
       values (%L, %L, 'Crew task') $$,
    :'org1', :'lead1'
  ),
  '42501',
  null,
  'crew cannot add a task'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.lead_tasks),
  0::bigint,
  'another org cannot see tasks'
);
select throws_ok(
  format(
    $$ insert into public.lead_tasks (org_id, lead_request_id, title)
       values (%L, %L, 'Cross') $$,
    :'org1', :'lead1'
  ),
  '42501',
  null,
  'another org cannot add a task on this lead'
);

select * from finish();
