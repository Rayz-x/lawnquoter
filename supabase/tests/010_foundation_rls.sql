select plan(20);

-- Fixtures -------------------------------------------------------------------
select tests.create_user('owner-a@example.com', 'Owner A')  as owner_a \gset
select tests.create_user('sales-a@example.com', 'Sales A')  as sales_a \gset
select tests.create_user('owner-b@example.com', 'Owner B')  as owner_b \gset
select tests.create_user('nobody@example.com',  'Nobody')   as nobody  \gset

select tests.create_org('Org A', 'org-a', :'owner_a'::uuid) as org_a \gset
select tests.create_org('Org B', 'org-b', :'owner_b'::uuid) as org_b \gset
select tests.add_member(:'org_a'::uuid, :'sales_a'::uuid, 'sales');

-- Schema sanity ---------------------------------------------------------------
select has_table('public', 'orgs', 'orgs table exists');
select has_table('public', 'memberships', 'memberships table exists');
select has_function('public', 'custom_access_token_hook', array['jsonb'], 'access token hook exists');

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.orgs'::regclass),
  'RLS is FORCED on orgs'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.memberships'::regclass),
  'RLS is FORCED on memberships'
);

-- Profiles auto-created by trigger -------------------------------------------
select is(
  (select count(*) from public.profiles where id = :'owner_a'::uuid),
  1::bigint,
  'profile row created for new auth user'
);

-- Owner A sees only Org A -----------------------------------------------------
select tests.authenticate_as(:'owner_a'::uuid, :'org_a'::uuid, 'owner');

select results_eq(
  'select id from public.orgs order by id',
  format('values (%L::uuid)', :'org_a'),
  'owner A sees exactly org A'
);

select is(
  (select count(*) from public.memberships),
  2::bigint,
  'owner A sees both memberships of org A and none of org B'
);

-- Owner A can update their org, not org B (0 rows affected, no error)
update public.orgs set name = 'Org A renamed' where id = :'org_a'::uuid;
select is((select name from public.orgs where id = :'org_a'::uuid), 'Org A renamed', 'owner can rename own org');

select tests.clear_auth();
select is((select name from public.orgs where id = :'org_b'::uuid), 'Org B', 'org B untouched before cross-tenant attempt');
select tests.authenticate_as(:'owner_a'::uuid, :'org_a'::uuid, 'owner');
update public.orgs set name = 'hacked' where id = :'org_b'::uuid;
select tests.clear_auth();
select is((select name from public.orgs where id = :'org_b'::uuid), 'Org B', 'cross-tenant update is a silent no-op');

-- Sales A can read but cannot manage memberships -----------------------------
select tests.authenticate_as(:'sales_a'::uuid, :'org_a'::uuid, 'sales');
select is((select count(*) from public.orgs), 1::bigint, 'sales user sees their org');
select throws_ok(
  format($$ insert into public.memberships (org_id, user_id, role) values (%L, %L, 'crew') $$, :'org_a', :'nobody'),
  '42501',
  null,
  'sales user cannot add members'
);

-- Owner A can add a member to org A but not to org B --------------------------
select tests.authenticate_as(:'owner_a'::uuid, :'org_a'::uuid, 'owner');
select lives_ok(
  format($$ insert into public.memberships (org_id, user_id, role) values (%L, %L, 'crew') $$, :'org_a', :'nobody'),
  'owner can add a member to own org'
);
select throws_ok(
  format($$ insert into public.memberships (org_id, user_id, role) values (%L, %L, 'crew') $$, :'org_b', :'nobody'),
  '42501',
  null,
  'owner cannot add a member to another org'
);

-- A spoofed JWT (claims org B, but no membership there) sees nothing ---------
select tests.authenticate_as(:'owner_a'::uuid, :'org_b'::uuid, 'owner');
select is((select count(*) from public.orgs), 0::bigint, 'spoofed org claim without membership sees no orgs');

-- Disabled member is locked out immediately -----------------------------------
select tests.clear_auth();
update public.memberships set status = 'disabled' where user_id = :'sales_a'::uuid;
select tests.authenticate_as(:'sales_a'::uuid, :'org_a'::uuid, 'sales');
select is((select count(*) from public.orgs), 0::bigint, 'disabled member sees no orgs even with a fresh token');

-- Anonymous sees nothing ------------------------------------------------------
select tests.authenticate_anon();
select throws_ok(
  $$ select count(*) from public.orgs $$,
  '42501',
  null,
  'anon has no privilege on orgs'
);

-- Access token hook stamps org + role -----------------------------------------
select tests.clear_auth();
select is(
  (
    public.custom_access_token_hook(
      jsonb_build_object('user_id', :'owner_a'::text, 'claims', '{"app_metadata":{}}'::jsonb)
    ) -> 'claims' -> 'app_metadata' ->> 'org_id'
  ),
  :'org_a'::text,
  'hook stamps active org id'
);
select is(
  (
    public.custom_access_token_hook(
      jsonb_build_object('user_id', :'owner_a'::text, 'claims', '{}'::jsonb)
    ) -> 'claims' -> 'app_metadata' ->> 'org_role'
  ),
  'owner',
  'hook stamps role'
);

select * from finish();
