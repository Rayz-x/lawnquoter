select plan(34);

select tests.create_user('integrity-owner@example.com', 'Integrity Owner') as owner \gset
select tests.create_org('Integrity', 'integrity', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset

-- Standalone included lines, one option group, and an optional extra.
select public.quote_create(:'acct'::uuid, null, 'Mixed quote') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'vid'::uuid, 'Mow', 'included', 100)
returning id as mow \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'vid'::uuid, 'Beds', 'included', 50)
returning id as bed \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'vid'::uuid, 'Aeration', 'optional', 25)
returning id as extra \gset
insert into public.quote_line_items (org_id, version_id, name, state, option_group, option_tier, price)
values (:'org'::uuid, :'vid'::uuid, 'Season good', 'optional', 'program', 'good', 200)
returning id as good \gset
insert into public.quote_line_items (org_id, version_id, name, state, option_group, option_tier, price)
values (:'org'::uuid, :'vid'::uuid, 'Season better', 'optional', 'program', 'better', 350)
returning id as better \gset
select public.quote_send(:'qid'::uuid) as tok \gset
select gen_random_uuid() as bogus \gset

select tests.authenticate_anon();
select throws_ok(
  format(
    $$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@test.com', true, 'ua', null, array[%L]::uuid[]) $$,
    :'tok',
    :'bogus'
  ),
  '22023',
  'unknown line item',
  'an unknown line-item id is rejected'
);

select throws_ok(
  format(
    $$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@test.com', true, 'ua', null, array[%L, %L]::uuid[]) $$,
    :'tok',
    :'good',
    :'better'
  ),
  '22023',
  'choose exactly one option in program',
  'choosing two options in a group is rejected'
);

select throws_ok(
  format(
    $$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@test.com', true, 'ua', null, array[%L]::uuid[]) $$,
    :'tok',
    :'extra'
  ),
  '22023',
  'choose exactly one option in program',
  'choosing no option in a group is rejected'
);

select ok(
  (
    public.quote_accept(
      :'tok'::uuid,
      'Pat Buyer',
      'pat@test.com',
      true,
      'ua',
      null,
      array[:'better'::uuid, :'extra'::uuid]
    ) ->> 'ok'
  ) = 'true',
  'accepts included lines, one option, and the optional extra'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select accepted_total from public.acceptances where quote_id = :'qid'::uuid),
  525::numeric,
  'accepted total is included lines plus the chosen option plus the extra'
);
select is(
  (select accepted_total from public.acceptances where quote_id = :'qid'::uuid),
  (
    select sum(price)
    from public.quote_line_items
    where id in (:'mow'::uuid, :'bed'::uuid, :'better'::uuid, :'extra'::uuid)
  ),
  'accepted total matches those four line prices'
);
select isnt(
  (select accepted_total from public.acceptances where quote_id = :'qid'::uuid),
  (
    select sum(price)
    from public.quote_line_items
    where id in (:'mow'::uuid, :'bed'::uuid, :'good'::uuid, :'extra'::uuid)
  ),
  'the unchosen option is not part of the accepted total'
);
select is(
  (select jsonb_array_length(selections) from public.acceptances where quote_id = :'qid'::uuid),
  4,
  'four lines are stored on the acceptance'
);
select is(
  (select selections from public.acceptances where quote_id = :'qid'::uuid),
  (
    select jsonb_agg(picked order by picked)
    from unnest(array[:'mow'::uuid, :'bed'::uuid, :'better'::uuid, :'extra'::uuid]) as picked
  ),
  'selections are the included lines, the chosen option, and the extra'
);
select ok(
  not ((select selections from public.acceptances where quote_id = :'qid'::uuid) ? :'good'),
  'the unchosen option is absent from selections'
);

-- Revise hides the public proposal until it is sent again.
select public.quote_create(:'acct'::uuid, null, 'Revise me') as rq \gset
select public.quote_current_version(:'rq'::uuid) as rvid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'rvid'::uuid, 'Mow', 'included', 80);
select public.quote_send(:'rq'::uuid) as rtok \gset
select tests.authenticate_anon();
select ok(public.quote_public(:'rtok'::uuid) is not null, 'a sent quote is visible');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_revise(:'rq'::uuid) as rvid2 \gset
select is((select current_version from public.quotes where id = :'rq'::uuid), 2, 'revise creates the next version');
select is((select status from public.quotes where id = :'rq'::uuid), 'changed', 'revise marks the quote changed');
select isnt(:'rvid2'::uuid, :'rvid'::uuid, 'revise returns a new version id');
select is(
  (select frozen from public.quote_versions where id = :'rvid2'::uuid),
  false,
  'the new version is not frozen'
);
select is(
  (select frozen from public.quote_versions where id = :'rvid'::uuid),
  true,
  'the sent version stays frozen'
);
select tests.authenticate_anon();
select ok(public.quote_public(:'rtok'::uuid) is null, 'a changed quote is hidden from quote_public');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_send(:'rq'::uuid) as resent \gset
select tests.authenticate_anon();
select ok(public.quote_public(:'rtok'::uuid) is not null, 'resending makes the revision visible');

-- Tamper with the frozen offer body and expect the hash check to reject it.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_create(:'acct'::uuid, null, 'Hash me') as hq \gset
select public.quote_send(:'hq'::uuid) as htok \gset
select tests.clear_auth();
alter table public.quotes disable trigger quotes_before_write;
update public.quotes set title = 'Tampered title' where id = :'hq'::uuid;
alter table public.quotes enable trigger quotes_before_write;
select tests.authenticate_anon();
select throws_ok(
  format($$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@test.com', true, 'ua') $$, :'htok'),
  '40001',
  'proposal changed',
  'a hash mismatch raises proposal changed'
);

-- Deleting a sent quote must still cascade through the frozen-version trigger.
-- A sent quote has no acceptance. Its operational audit rows are not signature
-- evidence, so they go away with the quote. Accepted quotes are different:
-- the quote, the acceptance, and the audit rows have to stay.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_create(:'acct'::uuid, null, 'Delete me') as dq \gset
select public.quote_current_version(:'dq'::uuid) as dvid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'dvid'::uuid, 'Mow', 'included', 40);
select public.quote_send(:'dq'::uuid) as dtok \gset
select throws_ok(
  format($$ delete from public.quote_line_items where version_id = %L::uuid $$, :'dvid'),
  '55000',
  'this quote version is frozen',
  'a frozen version still rejects a direct line delete'
);
select lives_ok(
  format($$ delete from public.quotes where id = %L::uuid $$, :'dq'),
  'deleting a sent quote cascades'
);
select tests.clear_auth();
select is((select count(*) from public.quote_versions where id = :'dvid'::uuid), 0::bigint, 'the frozen version is deleted');
select is((select count(*) from public.quote_line_items where version_id = :'dvid'::uuid), 0::bigint, 'line items are deleted');
select is((select count(*) from public.quote_sections where version_id = :'dvid'::uuid), 0::bigint, 'sections are deleted');
select is((select count(*) from public.audit_events where quote_id = :'dq'::uuid), 0::bigint, 'audit events are deleted');

-- An accepted quote is evidence. Deleting it must fail and leave the rows.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ delete from public.quotes where id = %L::uuid $$, :'qid'),
  '55000',
  'accepted quotes cannot be deleted',
  'deleting an accepted quote fails'
);
select is(
  (select count(*) from public.quotes where id = :'qid'::uuid),
  1::bigint,
  'the accepted quote remains'
);
select is(
  (select count(*) from public.acceptances where quote_id = :'qid'::uuid),
  1::bigint,
  'the acceptance row remains'
);
select ok(
  exists (
    select 1 from public.audit_events
    where quote_id = :'qid'::uuid and kind = 'quote.accepted'
  ),
  'the accepted quote audit event remains'
);
select is(
  (
    select confdeltype
    from pg_constraint
    where conrelid = 'public.acceptances'::regclass
      and conname = 'acceptances_quote_id_fkey'
  ),
  'a',
  'deleting a quote does not cascade to acceptances'
);
select is(
  (
    select confdeltype
    from pg_constraint
    where conrelid = 'public.audit_events'::regclass
      and conname = 'audit_events_quote_id_fkey'
  ),
  'a',
  'deleting a quote does not cascade to audit events'
);
select tests.clear_auth();
select throws_ok(
  format($$ delete from public.quotes where id = %L::uuid $$, :'qid'),
  '55000',
  'accepted quotes cannot be deleted',
  'the table owner cannot delete an accepted quote either'
);

-- A draft has no acceptance and no audit events, so it still deletes.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_create(:'acct'::uuid, null, 'Draft delete') as draftq \gset
select lives_ok(
  format($$ delete from public.quotes where id = %L::uuid $$, :'draftq'),
  'a draft quote with no acceptance still deletes'
);
select is(
  (select count(*) from public.quotes where id = :'draftq'::uuid),
  0::bigint,
  'the draft quote is gone'
);

select * from finish();
