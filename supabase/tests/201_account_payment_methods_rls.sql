select plan(10);

select tests.create_user('card-owner@example.com', 'Card Owner') as owner \gset
select tests.create_user('card-admin@example.com', 'Card Admin') as admin \gset
select tests.create_user('card-sales@example.com', 'Card Sales') as sales \gset
select tests.create_user('card-crew@example.com', 'Card Crew') as crew \gset
select tests.create_user('card-lead@example.com', 'Card Lead') as lead \gset
select tests.create_user('card-other@example.com', 'Card Other') as other \gset
select tests.create_org('Card Co', 'card-co', :'owner'::uuid) as org \gset
select tests.create_org('Card Other Co', 'card-other-co', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'admin'::uuid, 'admin');
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Oak Street')
returning id as account \gset

select throws_ok(
  format(
    $$ insert into public.account_payment_methods (org_id, account_id, stripe_customer_id, stripe_payment_method_id, kind, last4)
       values (%L, %L, 'cus_forged', 'pm_forged', 'card', '4242') $$,
    :'org', :'account'
  ),
  '42501', null, 'owner cannot insert a card on file'
);

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
insert into public.account_payment_methods (
  org_id, account_id, stripe_customer_id, stripe_payment_method_id, kind, brand, last4, is_default
) values (
  :'org'::uuid, :'account'::uuid, 'cus_card', 'pm_card', 'card', 'visa', '4242', true
);

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select last4 from public.account_payment_methods where account_id = :'account'::uuid),
  '4242',
  'owner can read the saved card'
);
select throws_ok(
  $$ update public.account_payment_methods set last4 = '1111' $$,
  '42501', null, 'owner cannot update a card on file'
);

select tests.authenticate_as(:'admin'::uuid, :'org'::uuid, 'admin');
select is((select count(*) from public.account_payment_methods), 1::bigint, 'admin can read cards on file');

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is((select count(*) from public.account_payment_methods), 0::bigint, 'sales cannot read cards on file');

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is((select count(*) from public.account_payment_methods), 0::bigint, 'crew cannot read cards on file');

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is((select count(*) from public.account_payment_methods), 0::bigint, 'crew lead cannot read cards on file');

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');
select is((select count(*) from public.account_payment_methods), 0::bigint, 'another company cannot read cards on file');

select throws_ok(
  format(
    $$ insert into public.account_payment_methods (org_id, account_id, stripe_customer_id, stripe_payment_method_id, kind)
       values (%L, %L, 'cus_x', 'pm_x', 'card') $$,
    :'org', :'account'
  ),
  '42501', null, 'another company cannot insert a card into this company'
);

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role2 \gset
select throws_ok(
  format(
    $$ insert into public.account_payment_methods (org_id, account_id, stripe_customer_id, stripe_payment_method_id, kind, is_default)
       values (%L, %L, 'cus_card', 'pm_second', 'card', true) $$,
    :'org', :'account'
  ),
  '23505', null, 'an account keeps a single default card'
);

select * from finish();
