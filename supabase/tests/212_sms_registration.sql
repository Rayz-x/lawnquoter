-- 10DLC registration: admins write, office can read, crew and other companies cannot.

select plan(11);

select has_table('public', 'org_sms_registrations', 'org_sms_registrations exists');

select tests.create_user('a2p-owner@example.com', 'Owner') as owner1 \gset
select tests.create_user('a2p-sales@example.com', 'Sales') as sales1 \gset
select tests.create_user('a2p-read@example.com', 'Read') as read1 \gset
select tests.create_user('a2p-crew@example.com', 'Crew') as crew1 \gset
select tests.create_user('a2p-disp@example.com', 'Dispatch') as disp1 \gset
select tests.create_user('a2p-owner2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('A2P One', 'a2p-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('A2P Two', 'a2p-two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'read1'::uuid, 'read_only');
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');
select tests.add_member(:'org1'::uuid, :'disp1'::uuid, 'dispatcher');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
insert into public.org_sms_registrations (org_id, legal_name, ein, brand_status)
values (:'org1'::uuid, 'North Lawn LLC', '123456789', 'draft');
select ok(
  (select legal_name from public.org_sms_registrations where org_id = :'org1'::uuid) = 'North Lawn LLC',
  'owner can save a 10DLC draft');

select tests.authenticate_as(:'disp1'::uuid, :'org1'::uuid, 'dispatcher');
select is(
  (select count(*) from public.org_sms_registrations where org_id = :'org1'::uuid),
  1::bigint,
  'dispatcher can read the registration');
select throws_ok(
  format($$ insert into public.org_sms_registrations (org_id, legal_name) values (%L, 'Nope') $$, :'org2'),
  '42501', null, 'dispatcher cannot register another company');

select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
update public.org_sms_registrations set legal_name = 'Changed' where org_id = :'org1'::uuid;
select is(
  (select legal_name from public.org_sms_registrations where org_id = :'org1'::uuid),
  'North Lawn LLC',
  'sales cannot change the registration');

select tests.authenticate_as(:'read1'::uuid, :'org1'::uuid, 'read_only');
select is(
  (select count(*) from public.org_sms_registrations where org_id = :'org1'::uuid),
  1::bigint,
  'read only can see the registration');

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is(
  (select count(*) from public.org_sms_registrations where org_id = :'org1'::uuid),
  0::bigint,
  'crew cannot read the registration');
select throws_ok(
  format($$ insert into public.org_sms_registrations (org_id, legal_name) values (%L, 'Crew') $$, :'org1'),
  '42501', null, 'crew cannot create a registration');

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.org_sms_registrations where org_id = :'org1'::uuid),
  0::bigint,
  'another company cannot read the registration');
select throws_ok(
  format($$ insert into public.org_sms_registrations (org_id, legal_name) values (%L, 'Other') $$, :'org1'),
  '42501', null, 'another company cannot write the registration');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select throws_ok(
  format($$ update public.org_sms_registrations set ein = '12' where org_id = %L $$, :'org1'),
  '23514', null, 'an EIN must be 9 digits');
