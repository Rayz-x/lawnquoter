-- Another company cannot reuse a texting number as its tracking number.
-- Owners cannot write either column. The server still cannot cross-claim.

select plan(5);

select tests.create_user('phone-claim-owner@example.com', 'Owner') as owner1 \gset
select tests.create_user('phone-claim-owner2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('Phone Claim One', 'phone-claim-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Phone Claim Two', 'phone-claim-two', :'owner2'::uuid) as org2 \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select throws_ok(
  format($$ update public.orgs set call_tracking_number = '+15550003333' where id = %L $$, :'org1'),
  '42501', null, 'an owner cannot set the tracking number directly');

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
select lives_ok(
  format($$ update public.orgs set sms_number = '+15550003333', call_tracking_number = '+15550003333' where id = %L $$, :'org1'),
  'one company can use the same number for texts and calls');
select throws_ok(
  format($$ update public.orgs set call_tracking_number = '+15550003333' where id = %L $$, :'org2'),
  '23505', null, 'another company cannot track calls on that texting number');
select throws_ok(
  format($$ update public.orgs set sms_number = '+15550003333' where id = %L $$, :'org2'),
  '23505', null, 'another company cannot text from that tracking number');
update public.orgs set call_tracking_number = '+15550004444' where id = :'org1'::uuid;
select throws_ok(
  format($$ update public.orgs set call_tracking_number = '+15550004444' where id = %L $$, :'org2'),
  '23505', null, 'another company cannot claim that tracking number');

select * from finish();
