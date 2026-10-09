select plan(9);

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('c1@example.com', 'Crew One')  as crew1  \gset
select tests.create_user('o2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Two', 'two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.accounts (org_id, name) values (:'org1'::uuid, 'Pat')
returning id as acct \gset

select public.quote_create(:'acct'::uuid, null, 'Spring mow') as qid \gset
select ok(:'qid'::uuid is not null, 'owner can create a quote');
select is((select number from public.quotes where id = :'qid'::uuid), 1, 'first quote is number 1');
select is((select count(*) from public.quote_versions where quote_id = :'qid'::uuid), 1::bigint, 'version 1 created');

select public_token as tok, status from public.quotes where id = :'qid'::uuid \gset
select tests.authenticate_anon();
select is(public.quote_public(:'tok'::uuid), null, 'draft quotes are hidden from the public RPC');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
update public.quotes set status = 'sent' where id = :'qid'::uuid;

select tests.authenticate_anon();
select is((public.quote_public(:'tok'::uuid) ->> 'title'), 'Spring mow', 'anon can read a sent quote by token');

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.quotes), 0::bigint, 'crew cannot read quotes');
select throws_ok(
  format($$ select public.quote_create(%L::uuid) $$, :'acct'),
  '42501',
  null,
  'crew cannot create quotes'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.quotes), 0::bigint, 'other org sees no quotes');
select is(public.quote_public(:'tok'::uuid) ->> 'title', 'Spring mow', 'token still works across tenants (public)');

select * from finish();
