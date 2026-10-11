-- I13: range-line billing clamps at cap until an accepted change order raises it.
-- Acceptance evidence is writable only via change_order_accept (security definer).
select plan(18);

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

-- Office authenticated cannot forge or edit acceptance evidence via table writes.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format(
    $$ insert into public.change_orders (
         org_id, account_id, quote_id, line_item_id, status,
         prior_cap_cents, proposed_amount_cents, new_cap_cents,
         sent_at, signer_name, disclosure_accepted, document_hash, accepted_at
       ) values (
         %L::uuid, %L::uuid, %L::uuid, %L::uuid, 'accepted',
         15000, 20000, 20000,
         now(), 'Forged Signer', true, 'deadbeef', now()
       ) $$,
    :'org', :'acct', :'qid', :'mow'
  ),
  '42501',
  null,
  'office cannot insert a forged accepted change order'
);

select id as sent_co from public.change_orders where public_token = :'cotok2'::uuid \gset
select throws_ok(
  format(
    $$ update public.change_orders
       set status = 'accepted',
           signer_name = 'Forged Signer',
           disclosure_accepted = true,
           document_hash = 'deadbeef',
           accepted_at = now()
       where id = %L::uuid $$,
    :'sent_co'
  ),
  '42501',
  null,
  'office cannot update a sent change order to accepted'
);

select is(
  (select status from public.change_orders where id = :'sent_co'::uuid),
  'sent'::public.change_order_status,
  'forged update left the change order sent'
);
select is(
  public.billable_line_amount_cents(:'mow'::uuid, 18000),
  15000::bigint,
  'forged accept did not raise the billing cap'
);

-- Legitimate accept still works; PUBLIC cannot execute the new RPCs by default grant.
select tests.authenticate_anon();
select lives_ok(
  format(
    $$ select public.change_order_accept(%L::uuid, 'Pat Customer', 'pat@example.com', true) $$,
    :'cotok2'
  ),
  'customer can still accept via change_order_accept'
);
select ok(
  not has_function_privilege(
    'public',
    'public.change_order_create(uuid, bigint, text)',
    'execute'
  )
  and not has_function_privilege(
    'public',
    'public.change_order_public(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'public',
    'public.change_order_accept(uuid, text, text, boolean)',
    'execute'
  ),
  'PUBLIC cannot execute the three change-order RPCs'
);

select * from finish();
