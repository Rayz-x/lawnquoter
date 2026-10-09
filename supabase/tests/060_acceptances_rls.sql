select plan(7);

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

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.acceptances), 0::bigint, 'other org cannot see acceptances');
select is((select count(*) from public.audit_events), 0::bigint, 'other org cannot see audit events');

select * from finish();
