select plan(7);

select tests.create_user('portal-owner@example.com', 'Portal Owner') as owner \gset
select tests.create_user('portal-crew@example.com', 'Portal Crew') as crew \gset
select tests.create_user('portal-other@example.com', 'Portal Other') as other \gset
select tests.create_org('Portal Co', 'portal-co', :'owner'::uuid) as org \gset
select tests.create_org('Other Portal', 'portal-other', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, type, name)
values (:'org'::uuid, 'commercial', 'North Portfolio')
returning id as acct \gset

insert into public.portal_links (org_id, account_id, email, expires_at)
values (:'org'::uuid, :'acct'::uuid, 'buyer@example.com', now() + interval '14 days')
returning id as link, token as tok \gset

select ok(:'tok'::uuid is not null, 'owner creates a portal link');

select lives_ok(
  format(
    $$ insert into public.portal_requests (org_id, account_id, portal_link_id, body) values (%L, %L, %L, 'Please add the north bed') $$,
    :'org', :'acct', :'link'
  ),
  'owner records a service request'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');

select throws_ok(
  format(
    $$ insert into public.portal_links (org_id, account_id, email, expires_at) values (%L, %L, 'crew@example.com', now() + interval '1 day') $$,
    :'org', :'acct'
  ),
  '42501',
  null,
  'crew cannot create a portal link'
);

select is(
  (select count(*) from public.portal_links),
  0::bigint,
  'crew cannot see portal links'
);

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');

select is((select count(*) from public.portal_links), 0::bigint, 'another org cannot see the link');
select is((select count(*) from public.portal_requests), 0::bigint, 'another org cannot see requests');

select throws_ok(
  format(
    $$ insert into public.portal_requests (org_id, account_id, portal_link_id, body) values (%L, %L, %L, 'Cross') $$,
    :'other_org', :'acct', :'link'
  ),
  '23503',
  null,
  'a request cannot attach a link from another org'
);
