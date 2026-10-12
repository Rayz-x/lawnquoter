-- Message templates: office can read, sales can write, crew and other orgs cannot.

select plan(13);

select has_table('public', 'message_templates', 'message_templates exists');

select tests.create_user('mt-owner@example.com', 'Owner') as owner1 \gset
select tests.create_user('mt-sales@example.com', 'Sales') as sales1 \gset
select tests.create_user('mt-read@example.com', 'Read') as read1 \gset
select tests.create_user('mt-crew@example.com', 'Crew') as crew1 \gset
select tests.create_user('mt-disp@example.com', 'Dispatch') as disp1 \gset
select tests.create_user('mt-owner2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('Templates One', 'templates-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Templates Two', 'templates-two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'read1'::uuid, 'read_only');
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');
select tests.add_member(:'org1'::uuid, :'disp1'::uuid, 'dispatcher');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
insert into public.message_templates (org_id, name, channel, purpose, body, is_default)
values (:'org1'::uuid, 'Quote text', 'sms', 'quote', 'Hi {customer name}', true)
returning id as template1 \gset
select ok(:'template1'::uuid is not null, 'owner can save a text template');

select throws_ok(
  format($$ insert into public.message_templates (org_id, name, channel, purpose, body, is_default)
           values (%L, 'Second', 'sms', 'quote', 'Again', true) $$, :'org1'),
  '23505', null, 'only one default text template per purpose');
select throws_ok(
  format($$ insert into public.message_templates (org_id, name, channel, purpose, subject, body)
           values (%L, 'Bad', 'sms', 'quote', 'Subject', 'Hi') $$, :'org1'),
  '23514', null, 'a text template cannot store a subject');

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.message_templates where id = :'template1'::uuid), 0::bigint, 'crew cannot read message templates');
select throws_ok(
  format($$ insert into public.message_templates (org_id, name, channel, purpose, body)
           values (%L, 'Nope', 'sms', 'general', 'Hi') $$, :'org1'),
  '42501', null, 'crew cannot create a message template');

select tests.authenticate_as(:'read1'::uuid, :'org1'::uuid, 'read_only');
select is((select name from public.message_templates where id = :'template1'::uuid), 'Quote text', 'read only can see templates');
select throws_ok(
  format($$ insert into public.message_templates (org_id, name, channel, purpose, body)
           values (%L, 'Nope', 'sms', 'general', 'Hi') $$, :'org1'),
  '42501', null, 'read only cannot create a message template');

select tests.authenticate_as(:'disp1'::uuid, :'org1'::uuid, 'dispatcher');
select is((select count(*) from public.message_templates where org_id = :'org1'::uuid), 1::bigint, 'dispatcher can read templates');
update public.message_templates set name = 'Changed' where id = :'template1'::uuid;
select is((select name from public.message_templates where id = :'template1'::uuid), 'Quote text', 'dispatcher cannot edit templates');

select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
select lives_ok(format($$ update public.message_templates set name = 'Quote SMS' where id = %L $$, :'template1'), 'sales can edit a template');

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.message_templates where id = :'template1'::uuid), 0::bigint, 'another company cannot read the template');
select throws_ok(
  format($$ insert into public.message_templates (org_id, name, channel, purpose, body)
           values (%L, 'Stolen', 'sms', 'general', 'Hi') $$, :'org1'),
  '42501', null, 'another company cannot create a template');

select * from finish();
