-- S19: expiry set on send; accept blocked after expiry; revise then resend.

select plan(10);

select tests.create_user('expiry-owner@example.com', 'Expiry Owner') as owner \gset
select tests.create_org('Expiry Co', 'expiry-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset

-- Send sets expires_at to current_date + 30 by default.
select public.quote_create(:'acct'::uuid, null, 'Fresh send') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'vid'::uuid, 'Mow', 'included', 50);
select public.quote_send(:'qid'::uuid) as tok \gset

select is(
  (select expires_at from public.quotes where id = :'qid'::uuid),
  current_date + 30,
  'send sets expires_at to 30 days from today'
);
select is(
  (select status from public.quotes where id = :'qid'::uuid),
  'sent',
  'send marks the quote sent'
);

-- Org setting 14 days is honored on the next send after revise.
update public.orgs
set settings = coalesce(settings, '{}'::jsonb) || '{"quote_expiry_days": 14}'::jsonb
where id = :'org'::uuid;
select public.quote_revise(:'qid'::uuid) as vid2 \gset
select is((select status from public.quotes where id = :'qid'::uuid), 'changed', 'revise marks the quote changed');
select public.quote_send(:'qid'::uuid) as tok2 \gset
select is(
  (select expires_at from public.quotes where id = :'qid'::uuid),
  current_date + 14,
  'send uses org quote_expiry_days when set'
);

-- Accept after expiry fails.
select public.quote_create(:'acct'::uuid, null, 'Age me') as oldq \gset
select public.quote_current_version(:'oldq'::uuid) as oldvid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'oldvid'::uuid, 'Mow', 'included', 40);
select public.quote_send(:'oldq'::uuid) as oldtok \gset
select tests.clear_auth();
alter table public.quotes disable trigger quotes_before_write;
update public.quotes set expires_at = current_date - 1 where id = :'oldq'::uuid;
alter table public.quotes enable trigger quotes_before_write;
select tests.authenticate_anon();
select throws_ok(
  format(
    $$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@test.com', true, 'ua') $$,
    :'oldtok'
  ),
  'P0002',
  null,
  'accept after expiry fails'
);

-- Persist expired, refuse send until revise, then resend and accept.
select tests.authenticate_anon();
select public.quote_record_view(:'oldtok'::uuid);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status from public.quotes where id = :'oldq'::uuid),
  'expired',
  'a view persists expired status'
);
select throws_ok(
  format($$ select public.quote_send(%L::uuid) $$, :'oldq'),
  '55000',
  'revise an expired quote before sending it again',
  'expired quotes must be revised before send'
);
select public.quote_revise(:'oldq'::uuid) as oldvid2 \gset
select is((select current_version from public.quotes where id = :'oldq'::uuid), 2, 'revise creates version 2');
select public.quote_send(:'oldq'::uuid) as newtok \gset
select is(
  (select expires_at from public.quotes where id = :'oldq'::uuid),
  current_date + 14,
  'resend after revise sets a fresh expiry'
);
select tests.authenticate_anon();
select lives_ok(
  format(
    $$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@test.com', true, 'ua') $$,
    :'newtok'
  ),
  'accept works on the revised, unexpired send'
);

select * from finish();
