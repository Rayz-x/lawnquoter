select plan(9);

select tests.create_user('plan-owner@example.com', 'Plan Owner') as owner \gset
select tests.create_user('plan-crew@example.com', 'Plan Crew') as crew \gset
select tests.create_user('plan-sales@example.com', 'Plan Sales') as sales \gset
select tests.create_user('plan-other@example.com', 'Plan Other') as other \gset
select tests.create_org('Plan Co', 'plan-co', :'owner'::uuid) as org \gset
select tests.create_org('Plan Other Co', 'plan-other-co', :'other'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');

select has_table('public', 'org_subscriptions', 'org_subscriptions exists');

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
insert into public.org_subscriptions (org_id, tier, status, stripe_subscription_id)
values (:'org'::uuid, 'starter', 'active', 'sub_plan_1');

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select tier from public.org_subscriptions where org_id = :'org'::uuid), 'starter', 'owner can read the company plan');
select throws_ok(
  format($$ insert into public.org_subscriptions (org_id, tier, status) values (%L, 'scale', 'active') $$, :'org'),
  '42501', null, 'owner cannot insert a plan'
);
select throws_ok(
  format($$ update public.org_subscriptions set tier = 'scale' where org_id = %L $$, :'org'),
  '42501', null, 'owner cannot change the plan'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is((select count(*) from public.org_subscriptions), 0::bigint, 'crew cannot read the plan');
select throws_ok(
  format($$ insert into public.org_subscriptions (org_id, tier, status) values (%L, 'growth', 'active') $$, :'org'),
  '42501', null, 'crew cannot insert a plan'
);

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is((select count(*) from public.org_subscriptions), 0::bigint, 'sales cannot read the plan');
select throws_ok(
  format($$ insert into public.org_subscriptions (org_id, tier, status) values (%L, 'growth', 'active') $$, :'org'),
  '42501', null, 'sales cannot insert a plan'
);

select tests.authenticate_as(:'other'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.org_subscriptions), 0::bigint, 'another company cannot read the plan');

select * from finish();
