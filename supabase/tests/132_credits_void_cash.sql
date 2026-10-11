-- I08: credit notes, void, account credit auto-apply, office cash/check.
select plan(18);

select tests.create_user('i08-owner@example.com', 'I08 Owner') as owner \gset
select tests.create_user('i08-admin@example.com', 'I08 Admin') as admin \gset
select tests.create_user('i08-office@example.com', 'I08 Office') as office \gset
select tests.create_org('I08 Co', 'i08-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'admin'::uuid, 'admin');
select tests.add_member(:'org'::uuid, :'office'::uuid, 'dispatcher');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name, type, net_terms_days, tax_exempt)
values (:'org'::uuid, 'I08 Acme', 'residential', 0, false)
returning id as acct \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org'::uuid, :'acct'::uuid, '8 Credit Ln', 'Nashville', 'TN', '37201'
) returning id as prop \gset

-- Issued invoice for credit note + void tests
insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'draft', 'manual',
  10000, 0, 10000
) returning id as inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'inv'::uuid, :'prop'::uuid, 'Mow',
  1, 10000, 10000, 0, true
);

select set_config('tests.issued', public.issue_invoice(:'inv'::uuid)::text, true) as _issued \gset

select is(
  (select status::text from public.invoices where id = :'inv'::uuid),
  'issued',
  'seed invoice is issued'
);

-- ---------------------------------------------------------------------------
-- Credit note never edits the original invoice; balance drops
-- ---------------------------------------------------------------------------
select set_config(
  'tests.cn',
  public.create_credit_note(:'inv'::uuid, 4000, 'Customer goodwill')::text,
  true
) as _cn \gset

select is(
  (select row(subtotal_cents, tax_cents, total_cents, status::text)
   from public.invoices where id = :'inv'::uuid),
  row(10000::bigint, 0::bigint, 10000::bigint, 'issued'::text),
  'credit note leaves original invoice totals and status unchanged'
);

select is(
  public.invoice_balance_cents(:'inv'::uuid),
  6000::bigint,
  'credit note reduces outstanding balance'
);

select is(
  (
    select count(*)::int from public.billing_events be
    where be.invoice_id = :'inv'::uuid
      and be.kind = 'credit_note.created'
      and be.payload ? 'actor_id'
      and be.payload ? 'reason'
      and be.payload ? 'before'
      and be.payload ? 'after'
  ),
  1,
  'credit note appends audited billing event with who/what/before/after/reason'
);

-- ---------------------------------------------------------------------------
-- Void rejected once any payment applied; void before payment keeps record
-- ---------------------------------------------------------------------------
insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'draft', 'manual',
  5000, 0, 5000
) returning id as void_inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'void_inv'::uuid, :'prop'::uuid, 'Edge trim',
  1, 5000, 5000, 0, true
);

select set_config('tests.void_issue', public.issue_invoice(:'void_inv'::uuid)::text, true) as _void_issue \gset

select set_config(
  'tests.voided',
  public.void_invoice(:'void_inv'::uuid, 'Duplicate billing')::text,
  true
) as _voided \gset

select is(
  (select status::text from public.invoices where id = :'void_inv'::uuid),
  'void',
  'void before payment sets status to void'
);

select ok(
  (select voided_at is not null from public.invoices where id = :'void_inv'::uuid),
  'void keeps the invoice record with voided_at'
);

select is(
  (
    select count(*)::int from public.billing_events be
    where be.invoice_id = :'void_inv'::uuid
      and be.kind = 'invoice.voided'
      and be.payload->>'reason' = 'Duplicate billing'
      and be.payload #>> '{before,status}' = 'issued'
      and be.payload #>> '{after,status}' = 'void'
  ),
  1,
  'void appends audited billing event with before/after status and reason'
);

-- Paid invoice cannot be voided
insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'draft', 'manual',
  3000, 0, 3000
) returning id as paid_inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'paid_inv'::uuid, :'prop'::uuid, 'Leaf cleanup',
  1, 3000, 3000, 0, true
);

select set_config('tests.paid_issue', public.issue_invoice(:'paid_inv'::uuid)::text, true) as _paid_issue \gset

select tests.authenticate_as(:'office'::uuid, :'org'::uuid, 'dispatcher');
select set_config(
  'tests.cash',
  public.record_office_payment(:'paid_inv'::uuid, 3000, 'cash', 'Paid at door')::text,
  true
) as _cash \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ select public.void_invoice(%L, 'too late') $$, :'paid_inv'),
  '55000',
  null,
  'void after payment fails'
);

select is(
  (select status::text from public.invoices where id = :'paid_inv'::uuid),
  'paid',
  'cash payment marks invoice paid'
);

select is(
  (
    select count(*)::int from public.payments p
    where p.invoice_id = :'paid_inv'::uuid
      and p.method = 'cash'
      and p.status = 'succeeded'
      and p.amount_cents = 3000
  ),
  1,
  'office cash payment is recorded on the ledger'
);

select is(
  (
    select count(*)::int from public.billing_events be
    where be.invoice_id = :'paid_inv'::uuid
      and be.kind = 'payment.office_recorded'
      and be.payload->>'reason' = 'Paid at door'
      and be.payload #>> '{after,method}' = 'cash'
  ),
  1,
  'office payment appends audited billing event'
);

-- Office can record check; crew-style roles cannot create credit notes
select tests.authenticate_as(:'office'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format(
    $$ select public.create_credit_note(%L, 100, 'nope') $$,
    :'inv'
  ),
  '42501',
  null,
  'office role cannot create credit notes'
);

insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'draft', 'manual',
  2000, 0, 2000
) returning id as check_inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'check_inv'::uuid, :'prop'::uuid, 'Aeration',
  1, 2000, 2000, 0, true
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select set_config('tests.check_issue', public.issue_invoice(:'check_inv'::uuid)::text, true) as _check_issue \gset
select tests.authenticate_as(:'office'::uuid, :'org'::uuid, 'dispatcher');
select set_config(
  'tests.check_pay',
  public.record_office_payment(:'check_inv'::uuid, 2000, 'check', 'Check #1042')::text,
  true
) as _check_pay \gset

select is(
  (select method::text from public.payments where invoice_id = :'check_inv'::uuid),
  'check',
  'office can record check payments'
);

-- ---------------------------------------------------------------------------
-- Account credit from over-credit auto-applies on next draft
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

-- Fully paid invoice: credit note becomes account credit
insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'draft', 'manual',
  8000, 0, 8000
) returning id as over_inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'over_inv'::uuid, :'prop'::uuid, 'Mulch',
  1, 8000, 8000, 0, true
);

select set_config('tests.over_issue', public.issue_invoice(:'over_inv'::uuid)::text, true) as _over_issue \gset
select tests.authenticate_as(:'office'::uuid, :'org'::uuid, 'dispatcher');
select set_config(
  'tests.over_pay',
  public.record_office_payment(:'over_inv'::uuid, 8000, 'cash', 'Paid in full')::text,
  true
) as _over_pay \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select set_config(
  'tests.over_cn',
  public.create_credit_note(:'over_inv'::uuid, 2500, 'Service credit after payment')::text,
  true
) as _over_cn \gset

select is(
  (
    select balance_cents from public.account_credits
    where account_id = :'acct'::uuid and currency = 'usd'
  ),
  2500::bigint,
  'credit note on a paid invoice becomes account credit'
);

-- Next draft auto-applies account credit
insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'draft', 'manual',
  10000, 0, 10000
) returning id as next_draft \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'next_draft'::uuid, :'prop'::uuid, 'Spring cleanup',
  1, 10000, 10000, 0, true
);

-- Touch totals so the draft apply trigger runs after lines exist with matching totals.
update public.invoices
set subtotal_cents = 10000, tax_cents = 0, total_cents = 10000
where id = :'next_draft'::uuid;

select is(
  (
    select coalesce(sum(p.amount_cents), 0)::bigint
    from public.payments p
    where p.invoice_id = :'next_draft'::uuid
      and p.method = 'account_credit'
      and p.status = 'succeeded'
  ),
  2500::bigint,
  'account credit auto-applies to the next draft'
);

select is(
  (
    select balance_cents from public.account_credits
    where account_id = :'acct'::uuid and currency = 'usd'
  ),
  0::bigint,
  'applied account credit depletes the pool'
);

select is(
  public.invoice_balance_cents(:'next_draft'::uuid),
  7500::bigint,
  'next draft balance reflects applied account credit'
);

select is(
  (
    select count(*)::int from public.billing_events be
    where be.invoice_id = :'next_draft'::uuid
      and be.kind = 'account_credit.applied'
      and be.payload ? 'before'
      and be.payload ? 'after'
  ),
  1,
  'account credit application is audited'
);

select * from finish();
