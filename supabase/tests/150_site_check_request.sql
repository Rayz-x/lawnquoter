-- Customer request a final price: caps, rate limit, approve/decline, no window
-- until office approval. Creates method crew_stop.

select plan(21);

select tests.create_user('req-owner@example.com', 'Request Owner') as owner \gset
select tests.create_user('req-sales@example.com', 'Request Sales') as sales \gset
select tests.create_org('Request Co', 'request-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Pat')
returning id as acct \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org'::uuid, :'acct'::uuid, '1 Main', 'Springfield', 'IL', '62704'
) returning id as prop \gset

select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Ranged request') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high, site_check_reasons
) values (
  :'org'::uuid, :'vid'::uuid, 'Mulch', 'included', 296, 261, 349, array['low_confidence']
) returning id as lid \gset
select public.quote_send(:'qid'::uuid) as tok \gset

select tests.authenticate_anon();

select ok(
  (public.quote_public(:'tok'::uuid) ->> 'site_check_can_request')::boolean,
  'quote_public allows a request on a sent ranged quote'
);
select ok(
  not (public.quote_public(:'tok'::uuid) ->> 'site_check_account_cap_reached')::boolean,
  'account cap is not reached before any request'
);

select ok(
  (public.site_check_request(:'tok'::uuid, 'pat@example.com', 'side gate locked') ->> 'ok') = 'true',
  'customer can request a final price'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (
    select status::text || ':' || origin::text || ':' || method::text
      || ':' || coalesce(window_start::text, 'none')
    from public.site_checks
    where quote_id = :'qid'::uuid
  ),
  'requested:customer_request:crew_stop:none',
  'request creates crew_stop with status requested and no window'
);
select is(
  (select site_check_status::text from public.quotes where id = :'qid'::uuid),
  'requested',
  'quotes.site_check_status mirrors requested'
);
select ok(
  (
    select 'customer_request' = any (reasons)
      and :'lid'::uuid = any (line_ids)
      and requested_email = 'pat@example.com'
      and request_note = 'side gate locked'
      and request_version = 1
    from public.site_checks
    where quote_id = :'qid'::uuid
  ),
  'request stores email, note, lines, reasons, and version'
);

select tests.authenticate_anon();
select is(
  public.quote_public(:'tok'::uuid) #>> '{site_check,status}',
  'requested',
  'quote_public exposes the open request'
);
select ok(
  public.quote_public(:'tok'::uuid) #>> '{site_check,window_start}' is null,
  'quote_public omits the window before approval'
);
select ok(
  not (public.quote_public(:'tok'::uuid) ->> 'site_check_can_request')::boolean,
  'a second request is not offered while one exists on this version'
);

select throws_ok(
  format(
    $$ select public.site_check_request(%L::uuid, 'pat@example.com', null) $$,
    :'tok'
  ),
  '22023',
  'a final price was already requested on this quote version',
  'RPC refuses a second request on the same version'
);

-- Office approve sets the window and schedules the crew stop.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.site_check_approve(
  (select id from public.site_checks where quote_id = :'qid'::uuid)
) as approved \gset

select ok(
  (:'approved'::jsonb ->> 'ok') = 'true'
    and (:'approved'::jsonb ->> 'status') = 'scheduled'
    and (:'approved'::jsonb ->> 'window_start') is not null
    and (:'approved'::jsonb ->> 'window_end') is not null,
  'approve returns scheduled status with a date window'
);
select is(
  (
    select status::text || ':' || (window_start is not null)::text || ':' || method::text
    from public.site_checks
    where quote_id = :'qid'::uuid
  ),
  'scheduled:true:crew_stop',
  'approve sets window and keeps method crew_stop'
);

select tests.authenticate_anon();
select ok(
  public.quote_public(:'tok'::uuid) #>> '{site_check,window_start}' is not null
    and public.quote_public(:'tok'::uuid) #>> '{site_check,status}' = 'scheduled',
  'after approval quote_public shows the window'
);

-- Decline path on a second quote.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Decline me') as q2 \gset
select public.quote_current_version(:'q2'::uuid) as v2 \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high
) values (
  :'org'::uuid, :'v2'::uuid, 'Beds', 'included', 200, 180, 230
);
select public.quote_send(:'q2'::uuid) as tok2 \gset
select tests.authenticate_anon();
select public.site_check_request(:'tok2'::uuid, 'pat@example.com') as req2 \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select ok(
  (
    public.site_check_decline(
      (:'req2'::jsonb ->> 'site_check_id')::uuid,
      'outside service area'
    ) ->> 'status'
  ) = 'declined',
  'office can decline with a reason'
);
select is(
  (
    select decline_reason
    from public.site_checks
    where id = (:'req2'::jsonb ->> 'site_check_id')::uuid
  ),
  'outside service area',
  'decline stores the reason'
);

select tests.authenticate_anon();
select is(
  public.quote_public(:'tok2'::uuid) #>> '{site_check,decline_reason}',
  'outside service area',
  'quote_public exposes the decline reason'
);

-- Account cap: two customer requests in 30 days blocks a third.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Cap three') as q3 \gset
select public.quote_current_version(:'q3'::uuid) as v3 \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high
) values (
  :'org'::uuid, :'v3'::uuid, 'Cap', 'included', 100, 90, 120
);
select public.quote_send(:'q3'::uuid) as tok3 \gset

select tests.authenticate_anon();
select ok(
  (public.quote_public(:'tok3'::uuid) ->> 'site_check_account_cap_reached')::boolean,
  'quote_public marks the account cap after two requests'
);
select throws_ok(
  format(
    $$ select public.site_check_request(%L::uuid, 'pat@example.com') $$,
    :'tok3'
  ),
  'P0001',
  'account request limit reached',
  'RPC enforces the 2-per-account-per-30d cap'
);

-- Cap already hit for this account — use a fresh account for cancel / rate tests.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Other')
returning id as acct2 \gset
insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org'::uuid, :'acct2'::uuid, '2 Oak', 'Springfield', 'IL', '62704'
) returning id as prop2 \gset
select public.quote_create(:'acct2'::uuid, :'prop2'::uuid, 'Cancel me') as q5 \gset
select public.quote_current_version(:'q5'::uuid) as v5 \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high
) values (
  :'org'::uuid, :'v5'::uuid, 'Mow', 'included', 80, 70, 95
);
select public.quote_send(:'q5'::uuid) as tok5 \gset

select tests.authenticate_anon();
select public.site_check_request(:'tok5'::uuid, 'other@example.com') as req5 \gset
select ok(
  (public.site_check_cancel_request(:'tok5'::uuid) ->> 'status') = 'cancelled',
  'customer can cancel a requested check before a visit is attached'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (
    select status::text from public.site_checks
    where id = (:'req5'::jsonb ->> 'site_check_id')::uuid
  ),
  'cancelled',
  'cancel sets status cancelled'
);

-- Rate limit: five prior hits in the hour block the sixth.
select public.quote_create(:'acct2'::uuid, :'prop2'::uuid, 'Rate limit') as q6 \gset
select public.quote_current_version(:'q6'::uuid) as v6 \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high
) values (
  :'org'::uuid, :'v6'::uuid, 'Rate', 'included', 80, 70, 95
);
select public.quote_send(:'q6'::uuid) as tok6 \gset

select tests.clear_auth();
insert into private.site_check_request_rate (token, created_at)
select :'tok6'::uuid, now() - (g || ' minutes')::interval
from generate_series(1, 5) as g;

select tests.authenticate_anon();
select throws_ok(
  format(
    $$ select public.site_check_request(%L::uuid, 'other@example.com') $$,
    :'tok6'
  ),
  'P0001',
  'rate limit exceeded',
  'RPC rate-limits to 5 requests per token per hour'
);

select * from finish();
