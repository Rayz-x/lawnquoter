select plan(5);

select tests.create_user('qbo-token-owner@example.com', 'QBO Owner') as owner \gset
select tests.create_user('qbo-token-other@example.com', 'QBO Other') as other \gset
select tests.create_org('QBO Token Co', 'qbo-token-co', :'owner'::uuid) as org \gset
select tests.create_org('QBO Token Other', 'qbo-token-other', :'other'::uuid) as other_org \gset

select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
insert into public.qbo_oauth_tokens (org_id, access_token, refresh_token, access_expires_at)
values (:'org'::uuid, 'access-1', 'refresh-1', now() + interval '1 hour');

select is(
  (select access_token from public.qbo_oauth_tokens where org_id = :'org'::uuid),
  'access-1',
  'the server can store a QuickBooks access token'
);

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  $$ select access_token from public.qbo_oauth_tokens $$,
  '42501', null, 'an owner cannot read QuickBooks tokens'
);
select throws_ok(
  format(
    $$ insert into public.qbo_oauth_tokens (org_id, access_token, refresh_token, access_expires_at) values (%L, 'x', 'y', now()) $$,
    :'org'
  ),
  '42501', null, 'an owner cannot write QuickBooks tokens'
);

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');
select throws_ok(
  $$ select access_token from public.qbo_oauth_tokens $$,
  '42501', null, 'another company cannot read QuickBooks tokens'
);

select * from finish();
