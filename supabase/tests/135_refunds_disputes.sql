-- I09: dispute columns, refund id uniqueness, staff still cannot write payments.
select plan(8);

select tests.create_user('i09-owner@example.com', 'I09 Owner') as owner \gset
select tests.create_org('I09 Co', 'i09-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Acme') returning id as acct \gset

insert into public.invoices (
  org_id, account_id, status, source, currency,
  subtotal_cents, tax_cents, total_cents, issued_at, paid_at, number, number_label, due_on
) values (
  :'org'::uuid, :'acct'::uuid, 'paid', 'manual', 'usd',
  10000, 0, 10000, now(), now(), 1, 'INV-2026-0001', current_date
) returning id as inv \gset

select has_column('public', 'invoices', 'payment_dispute_open', 'invoices.payment_dispute_open exists');
select has_column('public', 'invoices', 'payment_dispute_deadline', 'invoices.payment_dispute_deadline exists');
select has_column('public', 'accounts', 'payment_dispute_open', 'accounts.payment_dispute_open exists');
select has_column('public', 'payments', 'stripe_refund_id', 'payments.stripe_refund_id exists');

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset

insert into public.payments (
  org_id, account_id, invoice_id, amount_cents, currency, status,
  stripe_payment_intent_id, stripe_charge_id
) values (
  :'org'::uuid, :'acct'::uuid, :'inv'::uuid, 10000, 'usd', 'succeeded',
  'pi_i09_1', 'ch_i09_1'
) returning id as pay \gset;

update public.invoices
set
  payment_dispute_open = true,
  payment_dispute_deadline = timestamptz '2026-11-01 00:00:00+00',
  stripe_dispute_id = 'dp_i09_1'
where id = :'inv'::uuid;

update public.accounts
set payment_dispute_open = true
where id = :'acct'::uuid;

select is(
  (select payment_dispute_deadline from public.invoices where id = :'inv'::uuid),
  timestamptz '2026-11-01 00:00:00+00',
  'dispute deadline is stored on the invoice'
);

update public.payments
set status = 'refunded', stripe_refund_id = 're_i09_1'
where id = :'pay'::uuid;

select throws_ok(
  format(
    $$ insert into public.payments (
         org_id, account_id, invoice_id, amount_cents, currency, status,
         stripe_refund_id
       ) values (%L, %L, %L, 10000, 'usd', 'refunded', 're_i09_1') $$,
    :'org', :'acct', :'inv'
  ),
  '23505',
  null,
  'stripe_refund_id is unique'
);

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select throws_ok(
  format($$ update public.payments set status = 'refunded' where id = %L $$, :'pay'),
  '42501',
  null,
  'staff cannot mark a payment refunded directly'
);

select is(
  (select payment_dispute_open from public.accounts where id = :'acct'::uuid),
  true,
  'owner can read account dispute flag'
);

select * from finish();
