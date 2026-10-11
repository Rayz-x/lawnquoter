-- I11: statement links RLS (crew denied), public statement reconcile, ensure token.
select plan(10);

select tests.create_user('stmt-owner@example.com', 'Stmt Owner') as owner \gset
select tests.create_user('stmt-crew@example.com', 'Stmt Crew') as crew \gset
select tests.create_org('Stmt Co', 'stmt-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Acme Lawn')
returning id as acct \gset

-- Mint token
select public.ensure_account_statement_link(:'acct'::uuid) as tok \gset

select ok(:'tok'::uuid is not null, 'ensure_account_statement_link returns a token');

select is(
  public.ensure_account_statement_link(:'acct'::uuid),
  :'tok'::uuid,
  'ensure_account_statement_link is idempotent'
);

-- Seed ledger activity around September 2026
select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset

insert into public.invoices (
  org_id, account_id, status, source, currency,
  subtotal_cents, tax_cents, total_cents, number, issued_at, due_on
) values
  (
    :'org'::uuid, :'acct'::uuid, 'issued', 'manual', 'usd',
    10000, 0, 10000, 1,
    '2026-08-15T15:00:00Z', '2026-08-15'
  ),
  (
    :'org'::uuid, :'acct'::uuid, 'issued', 'manual', 'usd',
    6000, 0, 6000, 2,
    '2026-09-10T15:00:00Z', '2026-09-10'
  );

insert into public.payments (
  org_id, account_id, amount_cents, currency, status, method, received_at
) values
  (
    :'org'::uuid, :'acct'::uuid, 3000, 'usd', 'succeeded', 'cash',
    '2026-08-20T12:00:00Z'
  ),
  (
    :'org'::uuid, :'acct'::uuid, 2500, 'usd', 'succeeded', 'check',
    '2026-09-12T12:00:00Z'
  );

insert into public.credit_notes (
  org_id, account_id, amount_cents, currency, reason, issued_at
) values
  (
    :'org'::uuid, :'acct'::uuid, 1000, 'usd', 'goodwill',
    '2026-08-25T12:00:00Z'
  ),
  (
    :'org'::uuid, :'acct'::uuid, 500, 'usd', 'partial',
    '2026-09-18T12:00:00Z'
  );

select tests.clear_auth();

-- Public statement balances reconcile
select is(
  (public.account_statement_public(
    :'tok'::uuid, '2026-09-01'::date, '2026-09-30'::date
  )->>'opening_cents')::bigint,
  6000::bigint,
  'statement opening = prior invoices - payments - credits'
);

select is(
  (public.account_statement_public(
    :'tok'::uuid, '2026-09-01'::date, '2026-09-30'::date
  )->>'closing_cents')::bigint,
  9000::bigint,
  'statement closing = opening + invoices - payments - credits'
);

select is(
  (
    select (payload->>'closing_cents')::bigint
      = (payload->>'opening_cents')::bigint
        + (payload->>'invoice_cents')::bigint
        - (payload->>'payment_cents')::bigint
        - (payload->>'credit_cents')::bigint
    from (
      select public.account_statement_public(
        :'tok'::uuid, '2026-09-01'::date, '2026-09-30'::date
      ) as payload
    ) s
  ),
  true,
  'statement closing reconciles from components'
);

select is(
  public.account_statement_public(
    '00000000-0000-4000-8000-000000000099'::uuid,
    '2026-09-01'::date,
    '2026-09-30'::date
  ),
  null::jsonb,
  'unknown statement token returns null'
);

select ok(
  has_function_privilege(
    'anon',
    'public.account_statement_public(uuid, date, date)',
    'execute'
  ),
  'anon can execute account_statement_public'
);

-- Crew cannot read statement links
select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from public.account_statement_links),
  0::bigint,
  'crew cannot read account_statement_links'
);
select is(
  (select count(*) from public.payments),
  0::bigint,
  'crew cannot read payments'
);

select throws_ok(
  format($$ select public.ensure_account_statement_link(%L) $$, :'acct'),
  '42501',
  null,
  'crew cannot mint statement link'
);

select * from finish();
