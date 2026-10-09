select plan(39);

select tests.create_user('nte-owner@example.com', 'NTE Owner') as owner \gset
select tests.create_org('NTE Co', 'nte-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset

-- Opening the link must not mark the quote viewed.
select public.quote_create(:'acct'::uuid, null, 'View me') as vq \gset
select public.quote_send(:'vq'::uuid) as vtok \gset

select is(
  (
    select p.provolatile
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'quote_public' and p.pronargs = 1
  ),
  's',
  'quote_public is a stable read'
);
select ok(
  strpos(lower(pg_get_functiondef('public.quote_public(uuid)'::regprocedure)), 'for update') = 0,
  'quote_public does not lock the quote row'
);
select ok(
  strpos(lower(pg_get_functiondef('public.quote_public(uuid)'::regprocedure)), 'set status') = 0,
  'quote_public does not write quote status'
);

select tests.authenticate_anon();
select is((public.quote_public(:'vtok'::uuid) ->> 'title'), 'View me', 'a sent quote is still readable');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select status from public.quotes where id = :'vq'::uuid), 'sent', 'opening the public quote does not mark it viewed');
select ok((select viewed_at is null from public.quotes where id = :'vq'::uuid), 'opening the public quote does not set viewed_at');

select tests.authenticate_anon();
select lives_ok(
  format($$ select public.quote_record_view(%L::uuid) $$, :'vtok'),
  'a client view signal is accepted'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select status from public.quotes where id = :'vq'::uuid), 'viewed', 'the view signal marks a sent quote viewed');
update public.quotes set viewed_at = timestamptz '2000-01-01 00:00:00+00' where id = :'vq'::uuid;
select tests.authenticate_anon();
select public.quote_record_view(:'vtok'::uuid);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select ok(
  (select viewed_at = timestamptz '2000-01-01 00:00:00+00' from public.quotes where id = :'vq'::uuid),
  'a second view does not move viewed_at'
);

-- A past-due quote reads as expired without a write. The view signal persists it.
select public.quote_create(:'acct'::uuid, null, 'Expire me') as eq \gset
select public.quote_send(:'eq'::uuid) as etok \gset
-- Send freezes the offer, which also freezes expires_at. This test moves the
-- date after the fact, the same way a quote ages after it was sent.
select tests.clear_auth();
alter table public.quotes disable trigger quotes_before_write;
update public.quotes set expires_at = current_date - 1 where id = :'eq'::uuid;
alter table public.quotes enable trigger quotes_before_write;
select tests.authenticate_anon();
select is((public.quote_public(:'etok'::uuid) ->> 'status'), 'expired', 'a past-due quote reads as expired');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select status from public.quotes where id = :'eq'::uuid), 'sent', 'reading a past-due quote does not persist expiry');
select tests.authenticate_anon();
select public.quote_record_view(:'etok'::uuid);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select status from public.quotes where id = :'eq'::uuid), 'expired', 'a real view persists expiry');
select ok((select viewed_at is null from public.quotes where id = :'eq'::uuid), 'an expired quote is not marked viewed');

select public.quote_create(:'acct'::uuid, null, 'Draft me') as dq \gset
select public_token as dtok from public.quotes where id = :'dq'::uuid \gset
select tests.authenticate_anon();
select lives_ok(
  format($$ select public.quote_record_view(%L::uuid) $$, :'dtok'),
  'a view signal on a draft does not error'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select status from public.quotes where id = :'dq'::uuid), 'draft', 'a draft stays a draft');

select public.quote_create(:'acct'::uuid, null, 'Change me') as cq \gset
select public.quote_send(:'cq'::uuid) as ctok \gset
select public.quote_revise(:'cq'::uuid) as cvid \gset
select tests.authenticate_anon();
select public.quote_record_view(:'ctok'::uuid);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select status from public.quotes where id = :'cq'::uuid), 'changed', 'a changed quote is not marked viewed');

-- Ranged selection: cap is range_high plus fixed prices. The unselected range is ignored.
select public.quote_create(:'acct'::uuid, null, 'Ranged quote') as rq \gset
select public.quote_current_version(:'rq'::uuid) as rvid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price, range_low, range_high)
values (:'org'::uuid, :'rvid'::uuid, 'Mow', 'included', 100, 90, 120)
returning id as mow \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'rvid'::uuid, 'Beds', 'included', 50)
returning id as bed \gset
insert into public.quote_line_items (org_id, version_id, name, state, price, range_low, range_high, selected)
values (:'org'::uuid, :'rvid'::uuid, 'Aeration', 'optional', 25, 20, 40, false)
returning id as extra \gset
select public.quote_send(:'rq'::uuid) as rtok \gset

select tests.authenticate_anon();
select throws_ok(
  format($$ select public.quote_accept(%L::uuid, 'Pat Buyer', null, true, 'ua') $$, :'rtok'),
  '22023',
  'signer email required',
  'a missing signer email is rejected'
);
select throws_ok(
  format($$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'not-an-email', true, 'ua') $$, :'rtok'),
  '22023',
  'signer email required',
  'an invalid signer email is rejected'
);
select throws_ok(
  format($$ select public.quote_accept(%L::uuid, 'Pat Buyer', '   ', true, 'ua') $$, :'rtok'),
  '22023',
  'signer email required',
  'a blank signer email is rejected'
);
select ok(
  (public.quote_accept(:'rtok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua') ->> 'ok') = 'true',
  'a ranged quote accepts with a signer email'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select ok(
  (select accepted_total = 150::numeric from public.acceptances where quote_id = :'rq'::uuid),
  'accepted total stays the sum of point prices'
);
select ok(
  (select accepted_not_to_exceed = 170::numeric from public.acceptances where quote_id = :'rq'::uuid),
  'not-to-exceed is range_high for ranged lines plus fixed prices'
);
select is(
  (select has_ranges from public.acceptances where quote_id = :'rq'::uuid),
  true,
  'has_ranges is set when a selected line has a range'
);
select is(
  (select not_to_exceed_clause from public.acceptances where quote_id = :'rq'::uuid),
  'You agree to pay no more than $170.00; the final invoice may be lower.',
  'the stored clause names the not-to-exceed amount'
);
select ok(
  not ((select selections from public.acceptances where quote_id = :'rq'::uuid) ? :'extra'),
  'an unselected ranged line is not part of the acceptance'
);
select ok(
  (
    select (payload ->> 'accepted_not_to_exceed')::numeric
    from public.audit_events
    where quote_id = :'rq'::uuid and kind = 'quote.accepted'
  ) = 170::numeric,
  'the audit event records the not-to-exceed amount'
);
select is(
  (
    select payload ->> 'has_ranges'
    from public.audit_events
    where quote_id = :'rq'::uuid and kind = 'quote.accepted'
  ),
  'true',
  'the audit event records has_ranges'
);
select is(
  (
    select payload ->> 'not_to_exceed_clause'
    from public.audit_events
    where quote_id = :'rq'::uuid and kind = 'quote.accepted'
  ),
  (select not_to_exceed_clause from public.acceptances where quote_id = :'rq'::uuid),
  'the audit event records the clause'
);
select is(
  (
    select payload ->> 'disclosure_version'
    from public.audit_events
    where quote_id = :'rq'::uuid and kind = 'quote.accepted'
  ),
  '2026-10-09-draft',
  'the audit event records the disclosure version'
);
select tests.clear_auth();
select is(
  (select document_hash from public.acceptances where quote_id = :'rq'::uuid),
  private.acceptance_document_hash(
    (select document_hash from public.quote_versions where id = :'rvid'::uuid),
    (select selections from public.acceptances where quote_id = :'rq'::uuid),
    (select accepted_not_to_exceed from public.acceptances where quote_id = :'rq'::uuid),
    true,
    (select not_to_exceed_clause from public.acceptances where quote_id = :'rq'::uuid),
    '2026-10-09-draft'
  ),
  'the signed hash covers the offer, the cap, and the clause'
);
select isnt(
  private.acceptance_document_hash('abc', '[]'::jsonb, 170, true, 'clause', '2026-10-09-draft'),
  private.acceptance_document_hash('abc', '[]'::jsonb, 170, true, 'clause extra', '2026-10-09-draft'),
  'changing the clause changes the signed hash'
);
select isnt(
  private.acceptance_document_hash('abc', '[]'::jsonb, 170, true, 'clause', '2026-10-09-draft'),
  private.acceptance_document_hash('abc', '[]'::jsonb, 171, true, 'clause', '2026-10-09-draft'),
  'changing the not-to-exceed amount changes the signed hash'
);
select ok(
  (private.quote_document_body(:'rvid'::uuid))::text like '%' || private.not_to_exceed_clause_template() || '%',
  'the frozen offer includes the not-to-exceed clause template'
);
select is(
  (select document_hash from public.quote_versions where id = :'rvid'::uuid),
  private.sha256_hex((private.quote_document_body(:'rvid'::uuid))::text),
  'the stored offer hash is the body that includes the clause template'
);

-- A firm quote stores the same number as the cap and no clause.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_create(:'acct'::uuid, null, 'Firm quote') as fq \gset
select public.quote_current_version(:'fq'::uuid) as fvid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'fvid'::uuid, 'Mow', 'included', 80);
select public.quote_send(:'fq'::uuid) as ftok \gset
select tests.authenticate_anon();
select public.quote_accept(:'ftok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua') as firm_accept \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select has_ranges from public.acceptances where quote_id = :'fq'::uuid),
  false,
  'a firm quote does not set has_ranges'
);
select ok(
  (
    select accepted_not_to_exceed = accepted_total
    from public.acceptances
    where quote_id = :'fq'::uuid
  ),
  'a firm quote caps at the point-price total'
);
select ok(
  (select not_to_exceed_clause is null from public.acceptances where quote_id = :'fq'::uuid),
  'a firm quote stores no not-to-exceed clause'
);
select tests.clear_auth();
select is(private.esign_disclosure_version(), '2026-10-09-draft', 'disclosure version is the draft under review');
select is(
  private.not_to_exceed_clause(10),
  'You agree to pay no more than $10.00; the final invoice may be lower.',
  'the clause sentence matches the lawyer-editable copy'
);

select * from finish();
