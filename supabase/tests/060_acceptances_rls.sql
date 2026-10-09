select plan(18);

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('o2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Two', 'two', :'owner2'::uuid) as org2 \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org1'::uuid, 'Pat') returning id as acct \gset
select public.quote_create(:'acct'::uuid, null, 'Accept me') as qid \gset
select public_token as tok from public.quotes where id = :'qid'::uuid \gset
update public.quotes set status = 'sent' where id = :'qid'::uuid;

select tests.authenticate_anon();
select throws_ok(
  format($$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@test.com', false, 'test') $$, :'tok'),
  '22023',
  null,
  'disclosure is required'
);

select ok(
  (public.quote_accept(:'tok'::uuid, 'Pat Buyer', 'pat@test.com', true, 'vitest') ->> 'ok') = 'true',
  'anon can accept with disclosure'
);

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select is((select status from public.quotes where id = :'qid'::uuid), 'accepted', 'quote marked accepted');
select is((select count(*) from public.acceptances where quote_id = :'qid'::uuid), 1::bigint, 'acceptance row stored');
select is((select count(*) from public.audit_events where quote_id = :'qid'::uuid and kind = 'quote.accepted'), 1::bigint, 'audit event stored');
select is(length((select document_hash from public.acceptances where quote_id = :'qid'::uuid)), 64, 'document hash is sha256');

select tests.authenticate_anon();
select ok(
  (public.quote_accept(:'tok'::uuid, 'Pat Buyer', 'pat@test.com', true, 'vitest') ->> 'already') = 'true',
  'second accept is idempotent'
);

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select is((select count(*) from public.acceptances where quote_id = :'qid'::uuid), 1::bigint, 'still one acceptance');
select throws_ok(
  format($$ update public.quotes set status = 'sent' where id = %L::uuid $$, :'qid'),
  '55000',
  null,
  'accepted quotes stay accepted'
);

select public.quote_create(:'acct'::uuid, null, 'Freeze me') as qid2 \gset
select public.quote_send(:'qid2'::uuid) as tok2 \gset
select is((select frozen from public.quote_versions where quote_id = :'qid2'::uuid), true, 'send freezes the version');
select throws_ok(
  format(
    $$ insert into public.quote_line_items (org_id, version_id, name) values (%L, (select id from public.quote_versions where quote_id = %L), 'Extra') $$,
    :'org1',
    :'qid2'
  ),
  '55000',
  null,
  'frozen version rejects new lines'
);

select tests.authenticate_anon();
select ok(
  (public.quote_accept(:'tok2'::uuid, 'Pat Buyer', 'pat@test.com', true, 'ua', '203.0.113.5', null::uuid[]) ->> 'ok') = 'true',
  'accept records the signer'
);
select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select is((select host(ip) from public.acceptances where quote_id = :'qid2'::uuid), '203.0.113.5', 'signer ip stored');
select is(
  (select prev_hash from public.audit_events where quote_id = :'qid2'::uuid and kind = 'quote.accepted'),
  (select hash from public.audit_events where quote_id = :'qid2'::uuid and kind = 'quote.sent'),
  'acceptance chains to the send event'
);

select public.quote_create(:'acct'::uuid, null, 'Old quote') as qid3 \gset
update public.quotes set status = 'sent', expires_at = current_date - 1 where id = :'qid3'::uuid;
select public_token as tok3 from public.quotes where id = :'qid3'::uuid \gset
select tests.authenticate_anon();
select throws_ok(
  format($$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@test.com', true, 'ua') $$, :'tok3'),
  'P0002',
  null,
  'expired quotes cannot be accepted'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org2'::uuid, 'Other') returning id as acct2 \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org2'::uuid, :'acct2'::uuid, '1 Other St', 'Town', 'IL', '60601')
returning id as prop2 \gset
select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select throws_ok(
  format($$ select public.quote_create(%L::uuid, %L::uuid, 'Bad property') $$, :'acct', :'prop2'),
  '23503',
  null,
  'quote property must belong to the account'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.acceptances), 0::bigint, 'other org cannot see acceptances');
select is((select count(*) from public.audit_events), 0::bigint, 'other org cannot see audit events');

select * from finish();
