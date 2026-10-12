-- An owner cannot clear a carrier submission and mint another Twilio brand.

select plan(4);

select tests.create_user('a2p-lock-owner@example.com', 'Owner') as owner \gset
select tests.create_org('A2P Lock', 'a2p-lock', :'owner'::uuid) as org \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.org_sms_registrations (org_id, legal_name, ein)
values (:'org'::uuid, 'North Lawn LLC', '123456789');

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
update public.org_sms_registrations
set brand_status = 'pending', campaign_status = 'pending', brand_sid = 'BN1', campaign_sid = 'QE1', messaging_service_sid = 'MG1'
where org_id = :'org'::uuid;

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ update public.org_sms_registrations
    set brand_status = 'draft', campaign_status = 'draft', brand_sid = null, campaign_sid = null, messaging_service_sid = null
    where org_id = %L $$, :'org'),
  '42501', null, 'an owner cannot clear a carrier submission');

update public.org_sms_registrations set legal_name = 'North Lawn Inc' where org_id = :'org'::uuid;
select is(
  (select legal_name from public.org_sms_registrations where org_id = :'org'::uuid),
  'North Lawn Inc',
  'an owner can still edit the business draft');
select is(
  (select brand_status from public.org_sms_registrations where org_id = :'org'::uuid),
  'pending',
  'the brand status stays pending');
select is(
  (select brand_sid from public.org_sms_registrations where org_id = :'org'::uuid),
  'BN1',
  'the brand id stays on the row');

select * from finish();
