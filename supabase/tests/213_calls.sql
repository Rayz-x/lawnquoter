-- Calls: office can read the log, nobody in the app can insert, crew and other companies cannot see it.

select plan(9);

select has_table('public', 'calls', 'calls exists');
select has_column('public', 'orgs', 'call_tracking_number', 'orgs.call_tracking_number exists');

select tests.create_user('call-owner@example.com', 'Owner') as owner1 \gset
select tests.create_user('call-crew@example.com', 'Crew') as crew1 \gset
select tests.create_user('call-owner2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('Calls One', 'calls-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Calls Two', 'calls-two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

insert into public.calls (org_id, direction, from_address, to_address, recording_url, provider, provider_id)
values (:'org1'::uuid, 'in', '+15551110000', '+15552220000', 'https://recordings.example/1', 'callrail', 'CAL1')
returning id as call1 \gset
select ok(:'call1'::uuid is not null, 'a webhook can store a call');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select is((select count(*) from public.calls where id = :'call1'::uuid), 1::bigint, 'owner can read the call');
select throws_ok(
  format($$ insert into public.calls (org_id, from_address, to_address, provider, provider_id)
           values (%L, '+15550000000', '+15552220000', 'twilio', 'CA9') $$, :'org1'),
  '42501', null, 'office users cannot invent a call');

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.calls where id = :'call1'::uuid), 0::bigint, 'crew cannot read calls');

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.calls where id = :'call1'::uuid), 0::bigint, 'another company cannot read the call');
select throws_ok(
  format($$ insert into public.calls (org_id, from_address, to_address, provider, provider_id)
           values (%L, '+15550000000', '+15552220000', 'twilio', 'CA8') $$, :'org1'),
  '42501', null, 'another company cannot write a call');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
update public.orgs set call_tracking_number = '+15552220000' where id = :'org1'::uuid;
select is(
  (select call_tracking_number from public.orgs where id = :'org1'::uuid),
  '+15552220000',
  'owner can save the tracking number');
