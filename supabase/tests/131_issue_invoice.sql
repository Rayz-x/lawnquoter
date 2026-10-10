-- I04: issue invoice — gapless numbers, tax at issue, owner/admin only.
select plan(12);

select tests.create_user('issue-owner@example.com', 'Issue Owner') as owner \gset
select tests.create_user('issue-admin@example.com', 'Issue Admin') as admin \gset
select tests.create_user('issue-office@example.com', 'Issue Office') as office \gset
select tests.create_org('Issue Co', 'issue-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'admin'::uuid, 'admin');
select tests.add_member(:'org'::uuid, :'office'::uuid, 'dispatcher');

-- TN company default 0%; two properties with distinct rates for split.
update public.orgs
set region = 'TN', default_tax_rate_bps = 0
where id = :'org'::uuid;

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name, type, net_terms_days, tax_exempt)
values (:'org'::uuid, 'Residential Acme', 'residential', 0, false)
returning id as acct \gset

insert into public.accounts (org_id, name, type, net_terms_days, tax_exempt)
values (:'org'::uuid, 'Exempt Corp', 'commercial', 30, true)
returning id as exempt_acct \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code, tax_rate_bps
) values (
  :'org'::uuid, :'acct'::uuid, '1 Oak St', 'Nashville', 'TN', '37201', 0
) returning id as prop_a \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code, tax_rate_bps
) values (
  :'org'::uuid, :'acct'::uuid, '2 Pine St', 'Memphis', 'TN', '38103', 975
) returning id as prop_b \gset

-- ---------------------------------------------------------------------------
-- Office (dispatcher) cannot issue
-- ---------------------------------------------------------------------------
insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop_a'::uuid, 'draft', 'manual',
  5000, 0, 5000
) returning id as office_inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'office_inv'::uuid, :'prop_a'::uuid, 'Mow',
  1, 5000, 5000, 0, true
);

select tests.authenticate_as(:'office'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format($$ select public.issue_invoice(%L) $$, :'office_inv'),
  '42501',
  null,
  'office role cannot call issue_invoice'
);

-- ---------------------------------------------------------------------------
-- Gapless numbering under 20 issues (atomic counter; labels INV-YYYY-NNNN)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

create temporary table issue_batch (invoice_id uuid primary key) on commit drop;

with created as (
  insert into public.invoices (
    org_id, account_id, property_id, status, source,
    subtotal_cents, tax_cents, total_cents
  )
  select
    :'org'::uuid, :'acct'::uuid, :'prop_a'::uuid, 'draft', 'manual',
    1000, 0, 1000
  from generate_series(1, 20)
  returning id
)
insert into issue_batch (invoice_id)
select id from created;

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
)
select
  :'org'::uuid, b.invoice_id, :'prop_a'::uuid, 'Batch mow',
  1, 1000, 1000, 0, true
from issue_batch b;

select is((select count(*) from issue_batch), 20::bigint, 'seeded 20 draft invoices');

do $$
declare
  r record;
begin
  for r in select invoice_id from issue_batch order by invoice_id loop
    perform public.issue_invoice(r.invoice_id);
  end loop;
end;
$$;

select is(
  (
    select array_agg(number order by number)
    from public.invoices
    where id in (select invoice_id from issue_batch)
  ),
  (select array_agg(g order by g) from generate_series(1, 20) g),
  '20 issues produce numbers 1..20 with no gaps'
);

select is(
  (
    select array_agg(number_label order by number)
    from public.invoices
    where id in (select invoice_id from issue_batch)
  ),
  (
    select array_agg(
      'INV-' || to_char(timezone('America/Chicago', now()), 'YYYY') || '-' || lpad(g::text, 4, '0')
      order by g
    )
    from generate_series(1, 20) g
  ),
  'issued labels are INV-YYYY-NNNN'
);

select is(
  (
    select count(*) from public.billing_events be
    where be.invoice_id in (select invoice_id from issue_batch)
      and be.kind = 'invoice.issued'
  ),
  20::bigint,
  'each issue appends a billing event'
);

-- ---------------------------------------------------------------------------
-- TN 0%: tax label + totals frozen after company rate change
-- ---------------------------------------------------------------------------
insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, :'prop_a'::uuid, 'draft', 'manual',
  10000, 0, 10000
) returning id as tn_inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'tn_inv'::uuid, :'prop_a'::uuid, 'Weekly mow',
  1, 10000, 10000, 0, true
);

select set_config('tests.tn_issue', public.issue_invoice(:'tn_inv'::uuid)::text, true) as _tn_issue \gset

select is(
  (select tax_cents from public.invoices where id = :'tn_inv'::uuid),
  0::bigint,
  'TN default 0% yields tax_cents = 0'
);

select is(
  (select tax_label from public.invoices where id = :'tn_inv'::uuid),
  'Tax: $0.00 (services to real property, TN)',
  'TN shows services-to-real-property tax label'
);

select is(
  (select due_on from public.invoices where id = :'tn_inv'::uuid),
  (timezone('America/Chicago', now()))::date,
  'residential net 0 is due on receipt (issue date)'
);

-- Bump company rate after issue; locked totals must not move.
update public.orgs set default_tax_rate_bps = 975 where id = :'org'::uuid;

select is(
  (select row(tax_cents, total_cents, tax_label)
   from public.invoices where id = :'tn_inv'::uuid),
  row(0::bigint, 10000::bigint, 'Tax: $0.00 (services to real property, TN)'::text),
  'changing company rate after issue leaves issued totals unchanged'
);

-- ---------------------------------------------------------------------------
-- Exempt account never taxed; non-taxable line ignored even at high rate
-- ---------------------------------------------------------------------------
update public.orgs set default_tax_rate_bps = 0 where id = :'org'::uuid;

insert into public.invoices (
  org_id, account_id, property_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'exempt_acct'::uuid, :'prop_a'::uuid, 'draft', 'manual',
  8000, 0, 8000
) returning id as exempt_inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values (
  :'org'::uuid, :'exempt_inv'::uuid, :'prop_a'::uuid, 'Service',
  1, 8000, 8000, 0, true
);

-- Property rate is 0; set a high org default and property rate via service path
-- by updating property rate for this test on a commercial-like taxable property.
update public.properties set tax_rate_bps = 975 where id = :'prop_a'::uuid;
select set_config('tests.exempt_issue', public.issue_invoice(:'exempt_inv'::uuid)::text, true) as _exempt_issue \gset

select is(
  (select tax_cents from public.invoices where id = :'exempt_inv'::uuid),
  0::bigint,
  'exempt accounts never taxed'
);

-- ---------------------------------------------------------------------------
-- Split when lines span different property tax rates
-- ---------------------------------------------------------------------------
update public.properties set tax_rate_bps = 0 where id = :'prop_a'::uuid;

insert into public.invoices (
  org_id, account_id, status, source,
  subtotal_cents, tax_cents, total_cents
) values (
  :'org'::uuid, :'acct'::uuid, 'draft', 'consolidated',
  20000, 0, 20000
) returning id as split_inv \gset

insert into public.invoice_lines (
  org_id, invoice_id, property_id, description,
  quantity, unit_price_cents, amount_cents, sort, taxable
) values
  (:'org'::uuid, :'split_inv'::uuid, :'prop_a'::uuid, 'Mow A', 1, 10000, 10000, 0, true),
  (:'org'::uuid, :'split_inv'::uuid, :'prop_b'::uuid, 'Mow B', 1, 10000, 10000, 1, true);

select set_config('tests.split_issue', public.issue_invoice(:'split_inv'::uuid)::text, true) as _split_issue \gset

select is(
  (
    select count(*)::int from public.invoices i
    where i.account_id = :'acct'::uuid
      and i.status = 'issued'
      and i.source = 'consolidated'
  ),
  2,
  'invoice splits into one issued invoice per property tax rate'
);

select is(
  (
    select tax_cents from public.invoices i
    where i.account_id = :'acct'::uuid
      and i.status = 'issued'
      and i.source = 'consolidated'
      and exists (
        select 1 from public.invoice_lines l
        where l.invoice_id = i.id and l.property_id = :'prop_b'::uuid
      )
  ),
  975::bigint,
  '975 bps property yields $9.75 tax on $100.00 taxable line'
);

select * from finish();
