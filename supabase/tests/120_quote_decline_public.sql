-- Decline, resend, public redaction, and view signals on terminal quotes.

select plan(38);

select tests.create_user('decline-owner@example.com', 'Decline Owner') as owner \gset
select tests.create_org('Decline Co', 'decline-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset

-- A decline records the status and one audit row. A second decline changes nothing.
select public.quote_create(:'acct'::uuid, null, 'Decline me') as dq \gset
select public.quote_current_version(:'dq'::uuid) as dvid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'dvid'::uuid, 'Mow', 'included', 40);
select public.quote_send(:'dq'::uuid) as dtok \gset

select tests.authenticate_anon();
select public.quote_decline(:'dtok'::uuid, 'too expensive');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status from public.quotes where id = :'dq'::uuid),
  'declined',
  'declining sets the quote status to declined'
);
select is(
  (select count(*) from public.audit_events where quote_id = :'dq'::uuid and kind = 'quote.declined'),
  1::bigint,
  'declining writes one quote.declined audit row'
);
select is(
  (
    select payload ->> 'reason'
    from public.audit_events
    where quote_id = :'dq'::uuid and kind = 'quote.declined'
  ),
  'too expensive',
  'the decline audit row stores the reason'
);

select tests.authenticate_anon();
select lives_ok(
  format($$ select public.quote_decline(%L::uuid, 'changed my mind') $$, :'dtok'),
  'a second decline does not error'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status from public.quotes where id = :'dq'::uuid),
  'declined',
  'a second decline leaves the quote declined'
);
select is(
  (select count(*) from public.audit_events where quote_id = :'dq'::uuid and kind = 'quote.declined'),
  1::bigint,
  'a second decline does not write another audit row'
);
select is(
  (
    select payload ->> 'reason'
    from public.audit_events
    where quote_id = :'dq'::uuid and kind = 'quote.declined'
  ),
  'too expensive',
  'a second decline does not replace the recorded reason'
);

select tests.authenticate_anon();
select throws_ok(
  format(
    $$ select public.quote_accept(%L::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua') $$,
    :'dtok'
  ),
  'P0002',
  'quote not available',
  'quote_accept after a decline raises P0002'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select count(*) from public.acceptances where quote_id = :'dq'::uuid),
  0::bigint,
  'a declined quote has no acceptance row'
);
select is(
  (select status from public.quotes where id = :'dq'::uuid),
  'declined',
  'a rejected accept leaves the quote declined'
);

-- Resending a declined quote is rejected and the status stays declined.
select throws_ok(
  format($$ select public.quote_send(%L::uuid) $$, :'dq'),
  '55000',
  'revise a declined quote before sending it again',
  'quote_send on a declined quote raises 55000'
);
select is(
  (select status from public.quotes where id = :'dq'::uuid),
  'declined',
  'a rejected resend leaves the quote declined'
);

-- A view signal on a declined token that was never opened leaves it untouched.
select tests.authenticate_anon();
select lives_ok(
  format($$ select public.quote_record_view(%L::uuid) $$, :'dtok'),
  'a view signal on a declined quote does not error'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status from public.quotes where id = :'dq'::uuid),
  'declined',
  'recording a view leaves a declined quote declined'
);
select ok(
  (select viewed_at is null from public.quotes where id = :'dq'::uuid),
  'recording a view on a never-opened declined quote leaves viewed_at null'
);

-- A declined quote that already has a view keeps that timestamp.
select public.quote_create(:'acct'::uuid, null, 'View then decline') as vdq \gset
select public.quote_current_version(:'vdq'::uuid) as vdvid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'vdvid'::uuid, 'Mow', 'included', 40);
select public.quote_send(:'vdq'::uuid) as vdtok \gset
select tests.authenticate_anon();
select public.quote_record_view(:'vdtok'::uuid);
select public.quote_decline(:'vdtok'::uuid, 'no thanks');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
update public.quotes
set viewed_at = timestamptz '2000-01-01 00:00:00+00'
where id = :'vdq'::uuid;
select tests.authenticate_anon();
select public.quote_record_view(:'vdtok'::uuid);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status from public.quotes where id = :'vdq'::uuid),
  'declined',
  'recording a view after decline leaves the quote declined'
);
select ok(
  (select viewed_at = timestamptz '2000-01-01 00:00:00+00' from public.quotes where id = :'vdq'::uuid),
  'recording a view after decline leaves viewed_at unchanged'
);

-- An accepted quote cannot be declined, and a later view does not rewrite it.
select public.quote_create(:'acct'::uuid, null, 'Accept me') as aq \gset
select public.quote_current_version(:'aq'::uuid) as avid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org'::uuid, :'avid'::uuid, 'Mow', 'included', 80);
select public.quote_send(:'aq'::uuid) as atok \gset
select tests.authenticate_anon();
select public.quote_accept(:'atok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua') as accepted \gset
select throws_ok(
  format($$ select public.quote_decline(%L::uuid, 'too late') $$, :'atok'),
  'P0002',
  'quote not available',
  'an accepted quote cannot be declined'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status from public.quotes where id = :'aq'::uuid),
  'accepted',
  'a rejected decline leaves the quote accepted'
);
select is(
  (select count(*) from public.audit_events where quote_id = :'aq'::uuid and kind = 'quote.declined'),
  0::bigint,
  'a rejected decline writes no quote.declined audit row'
);
update public.quotes
set viewed_at = timestamptz '2000-01-01 00:00:00+00'
where id = :'aq'::uuid;
select tests.authenticate_anon();
select lives_ok(
  format($$ select public.quote_record_view(%L::uuid) $$, :'atok'),
  'a view signal on an accepted quote does not error'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status from public.quotes where id = :'aq'::uuid),
  'accepted',
  'recording a view leaves an accepted quote accepted'
);
select ok(
  (select viewed_at = timestamptz '2000-01-01 00:00:00+00' from public.quotes where id = :'aq'::uuid),
  'recording a view after accept leaves viewed_at unchanged'
);

-- The public payload hides internal fields. After accept, the acceptance echo matches the row.
select public.quote_create(:'acct'::uuid, null, 'Public me') as pq \gset
select public.quote_current_version(:'pq'::uuid) as pvid \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high, hours, cost, notes_customer, notes_crew, sort
) values (
  :'org'::uuid, :'pvid'::uuid, 'Mow', 'included', 100, 90, 120, 1.5, 30, 'Mow the front', 'bring the edger', 0
) returning id as mow \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, hours, cost, notes_crew, sort
) values (
  :'org'::uuid, :'pvid'::uuid, 'Beds', 'included', 50, 0.5, 10, 'rake the beds', 1
) returning id as bed \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, hours, cost, notes_crew, selected, sort
) values (
  :'org'::uuid, :'pvid'::uuid, 'Aeration', 'optional', 25, 1, 5, 'skip the aeration', false, 2
) returning id as extra \gset
update public.quotes set deposit_amount = 15 where id = :'pq'::uuid;
select public.quote_send(:'pq'::uuid) as ptok \gset

select is(
  (select cost from public.quote_line_items where id = :'mow'::uuid),
  30::numeric,
  'the line cost is stored'
);
select is(
  (select hours from public.quote_line_items where id = :'mow'::uuid),
  1.5::numeric,
  'the line hours are stored'
);
select is(
  (select notes_crew from public.quote_line_items where id = :'mow'::uuid),
  'bring the edger',
  'the crew note is stored'
);
select is(
  (select deposit_amount from public.quotes where id = :'pq'::uuid),
  15::numeric,
  'the deposit is stored'
);

select tests.authenticate_anon();
select is(
  jsonb_array_length(public.quote_public(:'ptok'::uuid) -> 'items'),
  3,
  'the public quote returns every line item'
);
select ok(
  public.quote_public(:'ptok'::uuid) is not null
  and not exists (
    select 1
    from jsonb_array_elements(public.quote_public(:'ptok'::uuid) -> 'items') as item
    where item ?| array['cost', 'hours', 'notes_crew']
  ),
  'public items omit cost, hours, and notes_crew'
);
select ok(
  public.quote_public(:'ptok'::uuid) is not null
  and not (public.quote_public(:'ptok'::uuid) ? 'deposit_amount'),
  'the public quote omits deposit_amount'
);
select is(
  public.quote_public(:'ptok'::uuid) #>> '{items,0,notes_customer}',
  'Mow the front',
  'public items still include the customer note'
);
select ok(
  public.quote_public(:'ptok'::uuid) is not null
  and position('bring the edger' in public.quote_public(:'ptok'::uuid)::text) = 0
  and position('rake the beds' in public.quote_public(:'ptok'::uuid)::text) = 0
  and position('skip the aeration' in public.quote_public(:'ptok'::uuid)::text) = 0,
  'crew notes are not in the public quote'
);

select public.quote_accept(:'ptok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua') as public_accepted \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select ok(
  (public.quote_public(:'ptok'::uuid) -> 'acceptance') is not null,
  'an accepted quote includes the acceptance object'
);
select is(
  public.quote_public(:'ptok'::uuid) -> 'acceptance' -> 'selections',
  (select selections from public.acceptances where quote_id = :'pq'::uuid),
  'public acceptance selections match the acceptance row'
);
select is(
  jsonb_array_length(public.quote_public(:'ptok'::uuid) -> 'acceptance' -> 'selections'),
  2,
  'the public acceptance selections are the two included lines'
);
select ok(
  not (public.quote_public(:'ptok'::uuid) -> 'acceptance' -> 'selections' ? :'extra'),
  'the public acceptance omits the unselected line'
);
select is(
  (public.quote_public(:'ptok'::uuid) #>> '{acceptance,accepted_not_to_exceed}')::numeric,
  (select accepted_not_to_exceed from public.acceptances where quote_id = :'pq'::uuid),
  'public accepted_not_to_exceed matches the acceptance row'
);
select is(
  (select accepted_not_to_exceed from public.acceptances where quote_id = :'pq'::uuid),
  170::numeric,
  'the acceptance cap is range_high plus the fixed price'
);

select * from finish();
