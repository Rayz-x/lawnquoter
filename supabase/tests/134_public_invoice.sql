-- I05: public invoice by token; draft/void hidden; invalid token null.
select plan(8);

select tests.create_user('inv-pub-owner@example.com', 'Inv Pub Owner') as owner \gset
select tests.create_org('Inv Pub Co', 'inv-pub-co', :'owner'::uuid) as org \gset

update public.orgs
set region = 'TN', default_tax_rate_bps = 0
where id = :'org'::uuid;

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name, type, net_terms_days, tax_exempt, email)
values (:'org'::uuid, 'Acme Home', 'residential', 0, false, 'billing@acme.test')
returning id as acct \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org'::uuid, :'acct'::uuid, '9 Elm St', 'Nashville', 'TN', '37201'
) returning id as prop \gset

insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'draft', 'manual',
  36500, 0, 36500
) returning id as inv, public_token as tok \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, taxable,
  estimate_low_cents, estimate_high_cents
) values (
  :'org'::uuid, :'inv'::uuid, :'prop'::uuid, 'Weekly mow',
  1, 36500, 36500, false,
  30000, 42000
);

-- Draft is not public
select is(
  public.invoice_public(:'tok'::uuid),
  null::jsonb,
  'draft invoice_public returns null'
);

select set_config('tests.issued', public.issue_invoice(:'inv'::uuid)::text, true) as _issued \gset

select ok(
  (select public_token is not null from public.invoices where id = :'inv'::uuid),
  'issued invoice keeps public_token'
);

select is(
  (public.invoice_public(:'tok'::uuid)->>'number_label') is not null,
  true,
  'issued invoice_public returns number_label'
);

select is(
  (public.invoice_public(:'tok'::uuid)->'lines'->0->>'estimate_low_cents')::bigint,
  30000::bigint,
  'public lines include estimate_low_cents'
);

select is(
  (public.invoice_public(:'tok'::uuid)->'lines'->0->>'estimate_high_cents')::bigint,
  42000::bigint,
  'public lines include estimate_high_cents'
);

select is(
  public.invoice_public('00000000-0000-4000-8000-000000000099'::uuid),
  null::jsonb,
  'unknown token returns null'
);

update public.invoices
set status = 'void', voided_at = now()
where id = :'inv'::uuid;

select is(
  public.invoice_public(:'tok'::uuid),
  null::jsonb,
  'void invoice_public returns null'
);

select ok(
  has_function_privilege('anon', 'public.invoice_public(uuid)', 'execute'),
  'anon can execute invoice_public'
);

select * from finish();
