-- A portal link is visible to sales roles and hidden from the rest of the office.

select plan(4);

select tests.create_user('link-owner@example.com', 'Link Owner') as owner \gset
select tests.create_user('link-sales@example.com', 'Link Sales') as sales \gset
select tests.create_user('link-dispatch@example.com', 'Link Dispatch') as dispatcher \gset
select tests.create_user('link-reader@example.com', 'Link Reader') as reader \gset
select tests.create_org('Link Co', 'link-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'reader'::uuid, 'read_only');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, type, name)
values (:'org'::uuid, 'commercial', 'North')
returning id as acct \gset

insert into public.portal_links (org_id, account_id, email, expires_at)
values (:'org'::uuid, :'acct'::uuid, 'buyer@example.com', now() + interval '14 days');

select is((select count(*) from public.portal_links), 1::bigint, 'owner can read the portal link');

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is((select count(*) from public.portal_links), 1::bigint, 'sales can read the portal link');

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select is((select count(*) from public.portal_links), 0::bigint, 'dispatcher cannot read the portal link');

select tests.authenticate_as(:'reader'::uuid, :'org'::uuid, 'read_only');
select is((select count(*) from public.portal_links), 0::bigint, 'read only cannot read the portal link');
