-- I01 / audit A3: billing ledger RLS, payment write lockdown, issued-invoice lock.
select plan(20);

select tests.create_user('bill-owner@example.com', 'Bill Owner') as owner \gset
select tests.create_user('bill-crew@example.com', 'Bill Crew') as crew \gset
select tests.create_user('bill-lead@example.com', 'Bill Lead') as lead \gset
select tests.create_org('Billing Co', 'billing-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Acme') returning id as acct \gset

insert into public.invoices (
  org_id, account_id, status, source, currency,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, 'draft', 'manual', 'usd',
  10000, 0, 10000
) returning id as inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, description, quantity, unit_price_cents, amount_cents, sort
) values (
  :'org'::uuid, :'inv'::uuid, 'Mow', 1, 10000, 10000, 0
) returning id as line \gset

-- Staff cannot write payment records (audit A3) --------------------------------
select throws_ok(
  format(
    $$ insert into public.payments (
         org_id, account_id, invoice_id, amount_cents, currency, status
       ) values (%L, %L, %L, 10000, 'usd', 'succeeded') $$,
    :'org', :'acct', :'inv'
  ),
  '42501',
  null,
  'staff cannot insert payments'
);

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
insert into public.payments (
  org_id, account_id, invoice_id, amount_cents, currency, status
) values (
  :'org'::uuid, :'acct'::uuid, :'inv'::uuid, 5000, 'usd', 'pending'
) returning id as pay \gset

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ update public.payments set status = 'succeeded' where id = %L $$, :'pay'),
  '42501',
  null,
  'staff cannot update payment status'
);

-- Issued invoice locks lines and totals ---------------------------------------
select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role2 \gset
update public.invoices
set status = 'issued', issued_at = now(), number = 1
where id = :'inv'::uuid;

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ update public.invoice_lines set amount_cents = 1 where id = %L $$, :'line'),
  '55000',
  null,
  'updating a line on an issued invoice fails'
);
select throws_ok(
  format($$ update public.invoices set total_cents = 1 where id = %L $$, :'inv'),
  '55000',
  null,
  'updating totals on an issued invoice fails'
);

-- Seed read-side rows for crew denial (service_role) --------------------------
select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role3 \gset
insert into public.credit_notes (
  org_id, account_id, invoice_id, amount_cents, currency, reason
) values (
  :'org'::uuid, :'acct'::uuid, :'inv'::uuid, 1000, 'usd', 'goodwill'
);
insert into public.account_credits (org_id, account_id, balance_cents, currency)
values (:'org'::uuid, :'acct'::uuid, 1000, 'usd');
insert into public.invoice_counters (org_id, next_number)
values (:'org'::uuid, 2)
on conflict (org_id) do update set next_number = excluded.next_number;
insert into public.billing_events (org_id, invoice_id, kind, payload)
values (:'org'::uuid, :'inv'::uuid, 'invoice.issued', '{}'::jsonb);
insert into public.stripe_events (org_id, stripe_event_id, event_type, payload)
values (:'org'::uuid, 'evt_billing_1', 'payment_intent.succeeded', '{}'::jsonb);

-- Crew / crew_lead see zero billing rows --------------------------------------
select tests.clear_auth();
select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is((select count(*) from public.invoices), 0::bigint, 'crew cannot read invoices');
select is((select count(*) from public.invoice_lines), 0::bigint, 'crew cannot read invoice lines');
select is((select count(*) from public.payments), 0::bigint, 'crew cannot read payments');
select is((select count(*) from public.credit_notes), 0::bigint, 'crew cannot read credit notes');
select is((select count(*) from public.account_credits), 0::bigint, 'crew cannot read account credits');
select is((select count(*) from public.billing_events), 0::bigint, 'crew cannot read billing events');
select is((select count(*) from public.stripe_events), 0::bigint, 'crew cannot read stripe events');
select is((select count(*) from public.invoice_counters), 0::bigint, 'crew cannot read invoice counters');

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is((select count(*) from public.invoices), 0::bigint, 'crew_lead cannot read invoices');
select is((select count(*) from public.invoice_lines), 0::bigint, 'crew_lead cannot read invoice lines');
select is((select count(*) from public.payments), 0::bigint, 'crew_lead cannot read payments');
select is((select count(*) from public.credit_notes), 0::bigint, 'crew_lead cannot read credit notes');
select is((select count(*) from public.account_credits), 0::bigint, 'crew_lead cannot read account credits');
select is((select count(*) from public.billing_events), 0::bigint, 'crew_lead cannot read billing events');
select is((select count(*) from public.stripe_events), 0::bigint, 'crew_lead cannot read stripe events');
select is((select count(*) from public.invoice_counters), 0::bigint, 'crew_lead cannot read invoice counters');

select * from finish();
