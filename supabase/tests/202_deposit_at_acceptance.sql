select plan(6);

select tests.create_user('deposit-owner@example.com', 'Deposit Owner') as owner \gset
select tests.create_org('Deposit Co', 'deposit-co', :'owner'::uuid) as org \gset

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Oak Street')
returning id as account \gset

insert into public.quotes (org_id, account_id, number, title, status, deposit_amount)
values (:'org'::uuid, :'account'::uuid, 7, 'Weekly mowing', 'accepted', 25)
returning id as quote \gset

insert into public.quotes (org_id, account_id, number, title, status, deposit_amount)
values (:'org'::uuid, :'account'::uuid, 8, 'No deposit', 'accepted', null)
returning id as free_quote \gset

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
select public.create_deposit_invoice(:'quote'::uuid) as invoice \gset

select is(
  (select source::text from public.invoices where id = :'invoice'::uuid),
  'deposit',
  'acceptance deposit is a deposit invoice'
);
select is(
  (select total_cents from public.invoices where id = :'invoice'::uuid),
  2500::bigint,
  'a 25 dollar deposit is 2500 cents'
);
select is(
  public.create_deposit_invoice(:'quote'::uuid),
  :'invoice'::uuid,
  'a second deposit request returns the same invoice'
);
select is(
  public.create_deposit_invoice(:'free_quote'::uuid),
  null,
  'a quote with no deposit does not create an invoice'
);

select throws_ok(
  format($$ update public.invoices set quote_id = null where id = %L $$, :'invoice'),
  '55000', null, 'an issued deposit invoice keeps its quote'
);

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ select public.create_deposit_invoice(%L) $$, :'quote'),
  '42501', null, 'the office cannot create a deposit invoice directly'
);

select * from finish();
