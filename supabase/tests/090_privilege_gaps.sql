select plan(49);

-- EXECUTE grants --------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.create_org(text, text, text)', 'execute'),
  'anon cannot execute create_org'
);
select ok(
  not has_function_privilege('public', 'public.create_org(text, text, text)', 'execute'),
  'PUBLIC cannot execute create_org'
);
select ok(
  not has_function_privilege('anon', 'public.set_active_org(uuid)', 'execute'),
  'anon cannot execute set_active_org'
);
select ok(
  not has_function_privilege('anon', 'public.quote_send(uuid)', 'execute'),
  'anon cannot execute quote_send'
);
select ok(
  not has_function_privilege('anon', 'public.quote_revise(uuid)', 'execute'),
  'anon cannot execute quote_revise'
);
select ok(
  not has_function_privilege('anon', 'public.create_org_invite(text, org_role)', 'execute'),
  'anon cannot execute create_org_invite'
);
select ok(
  has_function_privilege('authenticated', 'public.create_org(text, text, text)', 'execute'),
  'authenticated can execute create_org'
);
select ok(
  has_function_privilege('anon', 'public.quote_public(uuid)', 'execute')
  and has_function_privilege('anon', 'public.quote_accept(uuid, text, text, boolean, text, text, uuid[])', 'execute')
  and has_function_privilege('anon', 'public.quote_decline(uuid, text)', 'execute'),
  'anon keeps the public quote RPCs'
);
select ok(
  not has_function_privilege('public', 'public.quote_accept(uuid, text, text, boolean, text, text, uuid[])', 'execute'),
  'PUBLIC cannot execute quote_accept'
);
select ok(
  not has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute')
  and has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'only supabase_auth_admin can execute the access token hook'
);
select ok(
  exists (
    select 1
    from pg_default_acl a
    where a.defaclobjtype = 'f'
      and a.defaclnamespace = 0
      and not exists (
        select 1
        from aclexplode(a.defaclacl) x
        where x.grantee = 0
          and x.privilege_type = 'EXECUTE'
      )
  ),
  'new functions are not executable by PUBLIC'
);
select case
  when to_regprocedure('public.rls_auto_enable()') is null then
    ok(true, 'rls_auto_enable is absent from this database')
  else
    ok(
      not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
      and not has_function_privilege('public', 'public.rls_auto_enable()', 'execute'),
      'anon and PUBLIC cannot execute rls_auto_enable'
    )
end;

-- Invites ---------------------------------------------------------------------
select tests.create_user('invite-owner@example.com', 'Invite Owner') as owner \gset
select tests.create_user('invite-admin@example.com', 'Invite Admin') as admin \gset
select tests.create_user('invite-sales@example.com', 'Invite Sales') as sales \gset
select tests.create_user('invite-crew@example.com', 'Invite Crew') as crew \gset
select tests.create_user('invitee@example.com', 'Invitee') as invitee \gset
select tests.create_user('stranger@example.com', 'Stranger') as stranger \gset
select tests.create_user('other-owner@example.com', 'Other Owner') as owner2 \gset
select tests.create_org('Invite Co', 'invite-co', :'owner'::uuid) as org \gset
select tests.create_org('Other Co', 'other-co', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'admin'::uuid, 'admin');
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.org_invites'::regclass),
  'RLS is forced on org_invites'
);

-- JWT says admin, membership says sales.
select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'admin');
select throws_ok(
  $$ select public.create_org_invite('newhire@example.com', 'crew') $$,
  '42501',
  'only owners and admins can invite',
  'a stale admin claim cannot invite'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  $$ select public.create_org_invite('newhire@example.com', 'owner') $$,
  '22023',
  null,
  'owner role cannot be invited'
);
select (public.create_org_invite('invitee@example.com', 'crew') ->> 'token') as token \gset
select is(
  (select count(*) from public.memberships m join public.profiles p on p.id = m.user_id where p.email = 'invitee@example.com' and m.org_id = :'org'::uuid),
  0::bigint,
  'creating an invite does not add a membership'
);
select is(
  (select status::text from public.org_invites where email = 'invitee@example.com'),
  'pending',
  'invite is pending'
);
select ok(
  (select expires_at > now() + interval '6 days' from public.org_invites where email = 'invitee@example.com'),
  'invite expires in the future'
);
select throws_ok(
  format(
    $$ insert into public.org_invites (org_id, email, role, token_hash, expires_at, invited_by)
       values (%L, 'direct@example.com', 'crew', 'hash', now() + interval '1 day', %L) $$,
    :'org',
    :'owner'
  ),
  '42501',
  null,
  'members cannot insert invites directly'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.org_invites), 0::bigint, 'another org cannot see the invite');

select tests.authenticate_anon();
select throws_ok(
  $$ select count(*) from public.org_invites $$,
  '42501',
  null,
  'anon cannot read invites'
);

select tests.authenticate_as(:'stranger'::uuid, :'org2'::uuid, 'crew');
select throws_ok(
  format($$ select public.accept_org_invite(%L) $$, :'token'),
  '42501',
  'this invite was sent to a different email',
  'a different user cannot accept the invite'
);

select tests.authenticate_as(:'invitee'::uuid, :'org2'::uuid, 'crew');
select public.accept_org_invite(:'token') as membership \gset
select tests.clear_auth();
select is(
  (select role::text from public.memberships where user_id = :'invitee'::uuid and org_id = :'org'::uuid),
  'crew',
  'accepting the invite creates the membership'
);
select is(
  (select status::text from public.org_invites where email = 'invitee@example.com'),
  'accepted',
  'invite is accepted'
);

select tests.authenticate_as(:'admin'::uuid, :'org'::uuid, 'admin');
select (public.create_org_invite('late@example.com', 'sales') ->> 'token') as late_token \gset
select tests.clear_auth();
update public.org_invites set expires_at = now() - interval '1 minute' where email = 'late@example.com';
select tests.create_user('late@example.com', 'Late') as late \gset
select tests.authenticate_as(:'late'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.accept_org_invite(%L) $$, :'late_token'),
  '22023',
  'invite expired',
  'an expired invite cannot be accepted'
);
select tests.clear_auth();
select is(
  (select count(*) from public.memberships m join public.profiles p on p.id = m.user_id where p.email = 'late@example.com'),
  0::bigint,
  'an expired invite does not add a membership'
);

-- payment_intents -------------------------------------------------------------
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ insert into public.payment_intents (org_id, amount) values (%L, 10) $$, :'org'),
  '42501',
  null,
  'authenticated cannot insert payment intents'
);
select throws_ok(
  $$ update public.payment_intents set amount = 1 $$,
  '42501',
  null,
  'authenticated cannot update payment intents'
);
select tests.authenticate_anon();
select throws_ok(
  format($$ insert into public.payment_intents (org_id, amount) values (%L, 10) $$, :'org'),
  '42501',
  null,
  'anon cannot insert payment intents'
);

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
select lives_ok(
  format(
    $$ insert into public.payment_intents (org_id, amount, stripe_event_id) values (%L, 25, 'evt_privilege_1') $$,
    :'org'
  ),
  'service role can insert a payment intent'
);
select throws_ok(
  format(
    $$ insert into public.payment_intents (org_id, amount, stripe_event_id) values (%L, 25, 'evt_privilege_1') $$,
    :'org'
  ),
  '23505',
  null,
  'stripe event id is unique'
);
select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select amount from public.payment_intents where stripe_event_id = 'evt_privilege_1'),
  25::numeric,
  'a member can read the webhook-written payment intent'
);

-- Crew cannot read prices, costs, or gate codes ------------------------------
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset
select public.quote_create(:'acct'::uuid, null, 'Priced') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price, cost)
values (:'org'::uuid, :'vid'::uuid, 'Mow', 'included', 80, 30)
returning id as line \gset
update public.quotes set deposit_amount = 15 where id = :'qid'::uuid;
insert into public.services (org_id, name, slug) values (:'org'::uuid, 'Mow', 'mow') returning id as svc \gset
insert into public.pricing_rules (org_id, price_list_id, service_id, name, rule_type, config)
select :'org'::uuid, id, :'svc'::uuid, 'Tiers', 'tier_matrix', '{"type":"tier_matrix","quantityKey":"turf_sqft","rows":[]}'::jsonb
from public.price_lists
where org_id = :'org'::uuid and status = 'active';
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Gate St', 'Town', 'IL', '60601')
returning id as prop \gset
insert into public.property_access (property_id, org_id, gate_code, access_notes)
values (:'prop'::uuid, :'org'::uuid, '4321', 'side door');

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  $$ select price from public.quote_line_items $$,
  '42501',
  null,
  'crew cannot read line-item prices'
);
select throws_ok(
  $$ select cost from public.quote_line_items $$,
  '42501',
  null,
  'crew cannot read line-item costs'
);
select throws_ok(
  $$ select deposit_amount from public.quotes $$,
  '42501',
  null,
  'crew cannot read quote deposit amounts'
);
select is((select count(*) from public.quote_line_item_amounts), 0::bigint, 'crew cannot read line-item amount rows');
select is((select count(*) from public.quote_amounts), 0::bigint, 'crew cannot read quote amount rows');
select is((select count(*) from public.price_lists), 0::bigint, 'crew cannot read price lists');
select is((select count(*) from public.pricing_rules), 0::bigint, 'crew cannot read pricing rules');
select is((select count(*) from public.property_access), 0::bigint, 'crew cannot read unassigned gate codes');
select is((select count(*) from public.properties), 1::bigint, 'crew can still see the property');

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'admin');
select is((select count(*) from public.pricing_rules), 0::bigint, 'a spoofed admin claim does not reveal pricing rules');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select price from public.quote_line_item_amounts where line_item_id = :'line'::uuid),
  80::numeric,
  'owner can read the line price'
);
select is(
  (select cost from public.quote_line_item_amounts where line_item_id = :'line'::uuid),
  30::numeric,
  'owner can read the line cost'
);
select is(
  (select deposit_amount from public.quote_amounts where quote_id = :'qid'::uuid),
  15::numeric,
  'owner can read the quote deposit'
);
select is(
  (select gate_code from public.property_access where property_id = :'prop'::uuid),
  '4321',
  'owner can read the gate code'
);
select is(
  (select access_notes from public.property_access where property_id = :'prop'::uuid),
  'side door',
  'owner can read access notes'
);

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is((select count(*) from public.price_lists) > 0, true, 'sales can still read price lists');
select is(
  (select gate_code from public.property_access where property_id = :'prop'::uuid),
  '4321',
  'sales can still read the gate code'
);

select * from finish();
