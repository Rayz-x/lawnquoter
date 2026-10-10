select plan(8);

select tests.create_user('connect-owner@example.com', 'Connect Owner') as owner \gset
select tests.create_user('connect-admin@example.com', 'Connect Admin') as admin \gset
select tests.create_user('connect-sales@example.com', 'Connect Sales') as sales \gset
select tests.create_org('Connect Co', 'connect-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'admin'::uuid, 'admin');
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');

select has_table('public', 'org_stripe_connect', 'org_stripe_connect exists');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select lives_ok(
  format($$ insert into public.org_stripe_connect (org_id, stripe_account_id, status) values (%L, 'acct_test_owner', 'pending') $$, :'org'),
  'owner can insert connect settings'
);
select lives_ok(
  format($$ update public.org_stripe_connect set charges_enabled = true, payouts_enabled = true, status = 'ready' where org_id = %L $$, :'org'),
  'owner can update connect settings'
);
select is((select status::text from public.org_stripe_connect where org_id = :'org'::uuid), 'ready', 'owner can read connect settings');

select tests.authenticate_as(:'admin'::uuid, :'org'::uuid, 'admin');
select is((select status::text from public.org_stripe_connect where org_id = :'org'::uuid), 'ready', 'admin can read connect status');
select throws_ok(
  format($$ insert into public.org_stripe_connect (org_id, stripe_account_id, status) values (%L, 'acct_admin_forged', 'pending') $$, :'org'),
  '42501', null, 'admin cannot write connect settings'
);

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is((select count(*) from public.org_stripe_connect), 0::bigint, 'sales cannot read connect settings');

select tests.authenticate_as(:'admin'::uuid, :'org'::uuid, 'admin');
select is((select public.org_payments_ready()), true, 'members can ask whether payments are ready');

select * from finish();
