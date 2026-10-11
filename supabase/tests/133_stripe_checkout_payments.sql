-- I07: Stripe Checkout payment fields, processing status, ACH reopen path.
select plan(9);

select tests.create_user('i07-owner@example.com', 'I07 Owner') as owner \gset
select tests.create_org('I07 Co', 'i07-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Acme') returning id as acct \gset

insert into public.invoices (
  org_id, account_id, status, source, currency,
  subtotal_cents, tax_cents, total_cents, issued_at, number, number_label, due_on
) values (
  :'org'::uuid, :'acct'::uuid, 'issued', 'manual', 'usd',
  10000, 0, 10000, now(), 1, 'INV-2026-0001', current_date
) returning id as inv, public_token as tok \gset

select ok(:'tok'::uuid is not null, 'issued invoices get a public_token');

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset

insert into public.payments (
  org_id, account_id, invoice_id, amount_cents, currency, status,
  stripe_payment_intent_id, stripe_checkout_session_id, card_brand, card_last4
) values (
  :'org'::uuid, :'acct'::uuid, :'inv'::uuid, 10000, 'usd', 'processing',
  'pi_i07_1', 'cs_i07_1', 'visa', '4242'
) returning id as pay \gset

select is(
  (select status::text from public.payments where id = :'pay'::uuid),
  'processing',
  'payments may be processing for ACH'
);

select throws_ok(
  format(
    $$ insert into public.payments (
         org_id, account_id, invoice_id, amount_cents, currency, status,
         stripe_payment_intent_id
       ) values (%L, %L, %L, 10000, 'usd', 'succeeded', 'pi_i07_1') $$,
    :'org', :'acct', :'inv'
  ),
  '23505',
  null,
  'stripe_payment_intent_id is unique'
);

insert into public.stripe_events (org_id, stripe_event_id, event_type, payload, processed_at)
values (:'org'::uuid, 'evt_i07_1', 'checkout.session.completed', '{}'::jsonb, now());

select throws_ok(
  format(
    $$ insert into public.stripe_events (org_id, stripe_event_id, event_type, payload)
       values (%L, 'evt_i07_1', 'checkout.session.completed', '{}'::jsonb) $$,
    :'org'
  ),
  '23505',
  null,
  'stripe_event_id is unique for replay protection'
);

update public.payments
set status = 'succeeded', received_at = now()
where id = :'pay'::uuid;

update public.invoices
set status = 'paid', paid_at = now()
where id = :'inv'::uuid;

select is((select status::text from public.invoices where id = :'inv'::uuid), 'paid', 'card success marks paid');

-- Failed ACH reopens paid -> issued
update public.payments set status = 'failed', received_at = null where id = :'pay'::uuid;
update public.invoices
set status = 'issued', paid_at = null
where id = :'inv'::uuid;

select is(
  (select status::text from public.invoices where id = :'inv'::uuid),
  'issued',
  'failed ACH may reopen invoice to issued'
);

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select throws_ok(
  format(
    $$ insert into public.payments (
         org_id, account_id, invoice_id, amount_cents, currency, status
       ) values (%L, %L, %L, 10000, 'usd', 'succeeded') $$,
    :'org', :'acct', :'inv'
  ),
  '42501',
  null,
  'staff still cannot insert payments'
);

select throws_ok(
  format($$ update public.invoices set public_token = gen_random_uuid() where id = %L $$, :'inv'),
  '55000',
  null,
  'issued invoice public_token is locked'
);

select is(
  (select count(*) from public.payments where stripe_checkout_session_id = 'cs_i07_1'),
  1::bigint,
  'checkout session id stored once'
);

select * from finish();
