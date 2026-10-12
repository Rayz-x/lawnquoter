-- A texting number belongs to one company, and an owner cannot write it directly.

select plan(3);

select tests.create_user('sms-unique-owner@example.com', 'Owner') as owner1 \gset
select tests.create_user('sms-unique-owner2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('SMS Unique One', 'sms-unique-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('SMS Unique Two', 'sms-unique-two', :'owner2'::uuid) as org2 \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select throws_ok(
  format($$ update public.orgs set sms_number = '+15550001111' where id = %L $$, :'org1'),
  '42501', null, 'an owner cannot set the texting number directly');

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
select lives_ok(
  format($$ update public.orgs set sms_number = '+15550001111' where id = %L $$, :'org1'),
  'the server can claim a texting number');
select throws_ok(
  format($$ update public.orgs set sms_number = '+15550001111' where id = %L $$, :'org2'),
  '23505', null, 'another company cannot claim that texting number');

select * from finish();
