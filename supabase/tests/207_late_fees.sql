-- One late fee draft per overdue issued invoice per month. The issued total is not edited.

select plan(5);

select tests.create_user('late-owner@example.com', 'Late Owner') as owner \gset
select tests.create_user('late-crew@example.com', 'Late Crew') as crew \gset
select tests.create_org('Late Co', 'late-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

update public.orgs
set late_fee_flat_cents = 2500, late_fee_bps = 0, late_fee_grace_days = 0
where id = :'org'::uuid;

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Late Account') returning id as acct \gset

insert into public.invoices (
  org_id, account_id, status, source, currency,
  subtotal_cents, tax_cents, total_cents, issued_at, due_on, number_label
) values (
  :'org'::uuid, :'acct'::uuid, 'issued', 'manual', 'usd',
  10000, 0, 10000, now(), (timezone('America/Chicago', now()))::date - 1, 'INV-2026-9001'
) returning id as src \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(public.apply_late_fees(), 1, 'an overdue invoice gets one late fee draft');
select is(
  (select total_cents from public.invoices where fee_for_invoice_id = :'src'::uuid and source = 'late_fee'),
  2500::bigint,
  'the fee is the flat 25 dollars and the issued total stays 100 dollars'
);
select is(
  (select total_cents from public.invoices where id = :'src'::uuid),
  10000::bigint,
  'the issued invoice total is unchanged'
);
select is(public.apply_late_fees(), 0, 'the same month does not add a second late fee');

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  $$ select public.apply_late_fees() $$,
  '42501', null, 'crew cannot apply late fees'
);

select * from finish();
