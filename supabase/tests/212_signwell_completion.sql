select plan(7);

select tests.create_user('signwell-done-owner@example.com', 'SignWell Owner') as owner \gset
select tests.create_org('SignWell Done Co', 'signwell-done-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name, type) values (:'org'::uuid, 'Oak Commercial', 'commercial')
returning id as account \gset
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Home Lawn')
returning id as home \gset

select public.quote_create(:'account'::uuid, null, 'Season contract') as quote \gset
select public.quote_current_version(:'quote'::uuid) as version \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'version'::uuid, 'Weekly mowing', 'included', 40);
select public.quote_send(:'quote'::uuid);
update public.quotes set signwell_document_id = 'doc_completed' where id = :'quote'::uuid;

select public.quote_create(:'home'::uuid, null, 'House mowing') as home_quote \gset
select public.quote_current_version(:'home_quote'::uuid) as home_version \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'home_version'::uuid, 'Mow', 'included', 20);
select public.quote_send(:'home_quote'::uuid);
update public.quotes set signwell_document_id = 'doc_home' where id = :'home_quote'::uuid;

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset

select public.record_signwell_completion('doc_completed', 'Pat Buyer', 'pat@example.com') as first_result \gset

select is(
  (select status::text from public.quotes where id = :'quote'::uuid),
  'accepted',
  'a completed SignWell document accepts the quote'
);
select is(
  (select method::text from public.acceptances where quote_id = :'quote'::uuid),
  'signwell',
  'the acceptance method is signwell'
);
select is(
  (select signwell_envelope_id from public.acceptances where quote_id = :'quote'::uuid),
  'doc_completed',
  'the acceptance stores the SignWell document id'
);
select is(
  (public.record_signwell_completion('doc_completed', 'Pat Buyer', 'pat@example.com') ->> 'already')::boolean,
  true,
  'a second completion does not accept the quote again'
);

select throws_ok(
  $$ select public.record_signwell_completion('doc_home', 'Pat Buyer', 'pat@example.com') $$,
  '22023', null, 'a residential quote is not accepted through SignWell'
);
select throws_ok(
  $$ select public.record_signwell_completion('missing-doc', 'Pat Buyer', 'pat@example.com') $$,
  'P0002', null, 'an unknown SignWell document is refused'
);

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  $$ select public.record_signwell_completion('doc_completed', 'Pat Buyer', 'pat@example.com') $$,
  '42501', null, 'the office cannot record a SignWell completion directly'
);

select * from finish();
