-- SMS log: office reads, sales and dispatch send, crew and other companies cannot.

select plan(10);

select has_column('public', 'orgs', 'sms_number', 'orgs.sms_number exists');
select has_table('public', 'messages', 'messages exists');

select tests.create_user('sms-owner@example.com', 'Owner') as owner1 \gset
select tests.create_user('sms-sales@example.com', 'Sales') as sales1 \gset
select tests.create_user('sms-read@example.com', 'Read') as read1 \gset
select tests.create_user('sms-crew@example.com', 'Crew') as crew1 \gset
select tests.create_user('sms-disp@example.com', 'Dispatch') as disp1 \gset
select tests.create_user('sms-owner2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('SMS One', 'sms-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('SMS Two', 'sms-two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'read1'::uuid, 'read_only');
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');
select tests.add_member(:'org1'::uuid, :'disp1'::uuid, 'dispatcher');

select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
insert into public.messages (org_id, channel, direction, status, from_address, to_address, body)
values (:'org1'::uuid, 'sms', 'out', 'sent', '+15552220000', '+15551110000', 'Quote is ready')
returning id as message1 \gset
select ok(:'message1'::uuid is not null, 'sales can record an outbound text');

select tests.authenticate_as(:'disp1'::uuid, :'org1'::uuid, 'dispatcher');
select lives_ok(
  format($$ insert into public.messages (org_id, direction, status, from_address, to_address, body)
           values (%L, 'out', 'sent', '+15552220000', '+15551110000', 'On the way') $$, :'org1'),
  'dispatcher can record an outbound text');

select tests.authenticate_as(:'read1'::uuid, :'org1'::uuid, 'read_only');
select is((select count(*) from public.messages where id = :'message1'::uuid), 1::bigint, 'read only can see texts');
select throws_ok(
  format($$ insert into public.messages (org_id, direction, status, from_address, to_address, body)
           values (%L, 'out', 'sent', '+15552220000', '+15551110000', 'Nope') $$, :'org1'),
  '42501', null, 'read only cannot send a text');

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.messages where id = :'message1'::uuid), 0::bigint, 'crew cannot read texts');
select throws_ok(
  format($$ insert into public.messages (org_id, direction, status, from_address, to_address, body)
           values (%L, 'out', 'sent', '+15552220000', '+15551110000', 'Nope') $$, :'org1'),
  '42501', null, 'crew cannot send a text');

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.messages where id = :'message1'::uuid), 0::bigint, 'another company cannot read the text');
select throws_ok(
  format($$ insert into public.messages (org_id, direction, status, from_address, to_address, body)
           values (%L, 'out', 'sent', '+15552220000', '+15551110000', 'Stolen') $$, :'org1'),
  '42501', null, 'another company cannot write a text');

select * from finish();
