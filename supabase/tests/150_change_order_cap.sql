-- I13: range-line billing clamps at cap until an accepted change order raises it.
select plan(12);

select tests.create_user('co-owner@example.com', 'CO Owner') as owner \gset
select tests.create_user('co-crew@example.com', 'CO Crew') as crew \gset
select tests.create_org('Change Order Co', 'change-order-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset

select public.quote_create(:'acct'::uuid, null, 'Ranged mow') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, price, range_low, range_high
) values (
  :'org'::uuid, :'vid'::uuid, 'Mow', 'included', 100, 90, 120
) returning id as mow \gset

-- Over-cap actual clamps to range_high ($120 = 12000 cents) without a change order.
select is(
  public.billable_line_amount_cents(:'mow'::uuid, 15000),
  12000::bigint,
  'over-cap actual clamps to range high'
);
select is(
  public.billable_line_amount_cents(:'mow'::uuid, 11000),
  11000::bigint,
  'under-cap actual bills the actual'
);

-- Office creates a change order to bill $150 (above the $120 cap).
select public.change_order_create(
  :'mow'::uuid,
  15000,
  'Extra bed cleanup found on site'
) as cotok \gset

select is(
  (select status from public.change_orders where public_token = :'cotok'::uuid),
  'sent'::public.change_order_status,
  'change order is sent with a public token'
);
select is(
  public.billable_line_amount_cents(:'mow'::uuid, 15000),
  12000::bigint,
  'unaccepted change order still clamps at the original cap'
);

-- Customer accepts via the public token.
select tests.authenticate_anon();
select ok(
  (public.change_order_public(:'cotok'::uuid) ->> 'line_name') = 'Mow',
  'public payload exposes the line name'
);
select is(
  (public.change_order_public(:'cotok'::uuid) ->> 'proposed_amount_cents')::bigint,
  15000::bigint,
  'public payload shows the proposed amount'
);

select lives_ok(
  format(
    $$ select public.change_order_accept(%L::uuid, 'Pat Customer', 'pat@example.com', true) $$,
    :'cotok'
  ),
  'customer can accept the change order anonymously'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status from public.change_orders where public_token = :'cotok'::uuid),
  'accepted'::public.change_order_status,
  'accepted change order is marked accepted'
);
select is(
  public.billable_line_amount_cents(:'mow'::uuid, 15000),
  15000::bigint,
  'post-acceptance bills the actual up to the new cap'
);
select is(
  public.billable_line_amount_cents(:'mow'::uuid, 16000),
  15000::bigint,
  'post-acceptance still clamps above the raised cap'
);

-- Crew cannot read change orders.
select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from public.change_orders),
  0::bigint,
  'crew cannot read change orders'
);

-- Declined / invalid accept paths stay clamped.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.change_order_create(:'mow'::uuid, 18000, 'Second bump') as cotok2 \gset
select tests.authenticate_anon();
select throws_ok(
  format(
    $$ select public.change_order_accept(%L::uuid, 'Pat', 'pat@example.com', false) $$,
    :'cotok2'
  ),
  '22023',
  null,
  'accept without ESIGN disclosure fails'
);

select * from finish();
