-- I10 (#77): claim / flag RPCs are service_role-only and idempotent.

select plan(8);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_invoice_payment_reminder(uuid, uuid, public.payment_reminder_stage, date)',
    'execute'
  ),
  'authenticated cannot claim payment reminders'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_invoice_payment_reminder(uuid, uuid, public.payment_reminder_stage, date)',
    'execute'
  ),
  'service_role can claim payment reminders'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.flag_account_collections(uuid, uuid)',
    'execute'
  ),
  'authenticated cannot flag collections'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.flag_account_collections(uuid, uuid)',
    'execute'
  ),
  'service_role can flag collections'
);

select tests.create_user('remind-owner@example.com', 'Remind Owner') as owner \gset
select tests.create_org('Remind Co', 'remind-co', :'owner'::uuid) as org \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name, billing_email, status)
values (:'org'::uuid, 'Pat Home', 'pat@example.com', 'active')
returning id as acct \gset

-- Seed an already-issued invoice (issue_invoice RPC not required for claim/flag).
insert into public.invoices (
  org_id, account_id, status, source, currency,
  subtotal_cents, tax_cents, total_cents,
  issued_at, due_on, number, number_label
)
values (
  :'org'::uuid, :'acct'::uuid, 'issued', 'manual', 'usd',
  10000, 0, 10000,
  timestamptz '2026-10-01 12:00:00+00', date '2026-10-10', 1, 'INV-2026-0001'
)
returning id as inv \gset

select tests.clear_auth();
select set_config('role', 'service_role', true);

select ok(
  public.claim_invoice_payment_reminder(
    :'inv'::uuid, :'org'::uuid, 'due', date '2026-10-10'
  ) = true,
  'first claim succeeds'
);

select ok(
  public.claim_invoice_payment_reminder(
    :'inv'::uuid, :'org'::uuid, 'due', date '2026-10-10'
  ) = false,
  'rerun claim is a no-op'
);

select ok(
  public.flag_account_collections(:'acct'::uuid, :'org'::uuid) = true,
  'first collections flag succeeds'
);

select ok(
  public.flag_account_collections(:'acct'::uuid, :'org'::uuid) = false,
  'collections flag is once-only'
);

select * from finish();
