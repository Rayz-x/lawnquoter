-- S18: Lead → Active on quote acceptance or agreement/job creation.

select plan(8);

select tests.create_user('lead-active-owner@example.com', 'Lead Active Owner') as owner \gset
select tests.create_org('Lead Active Co', 'lead-active-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

-- Acceptance flips a Lead account to Active.
insert into public.accounts (org_id, name, status)
values (:'org'::uuid, 'Accept Flip', 'lead')
returning id as acct_accept \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct_accept'::uuid, '10 Oak', 'Springfield', 'IL', '62704')
returning id as prop_accept \gset
select public.quote_create(:'acct_accept'::uuid, :'prop_accept'::uuid, 'Accept flip quote') as q_accept \gset
select public.quote_send(:'q_accept'::uuid) as tok_accept \gset
select is(
  (select status::text from public.accounts where id = :'acct_accept'::uuid),
  'lead',
  'account starts as lead before acceptance'
);
select tests.authenticate_anon();
select ok(
  (public.quote_accept(
    :'tok_accept'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua', null, null
  ) ->> 'ok') = 'true',
  'anon can accept the quote'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status::text from public.accounts where id = :'acct_accept'::uuid),
  'active',
  'acceptance flips lead to active'
);

-- Archived (inactive) accounts are not auto-activated on acceptance.
insert into public.accounts (org_id, name, status)
values (:'org'::uuid, 'Archived Stay', 'inactive')
returning id as acct_archived \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct_archived'::uuid, '11 Oak', 'Springfield', 'IL', '62704')
returning id as prop_archived \gset
select public.quote_create(:'acct_archived'::uuid, :'prop_archived'::uuid, 'Archived quote') as q_archived \gset
select public.quote_send(:'q_archived'::uuid) as tok_archived \gset
select tests.authenticate_anon();
select public.quote_accept(
  :'tok_archived'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua', null, null
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select status::text from public.accounts where id = :'acct_archived'::uuid),
  'inactive',
  'acceptance does not unarchive an inactive account'
);

-- Job/agreement creation flips a Lead that was manually reset after accept.
insert into public.accounts (org_id, name, status)
values (:'org'::uuid, 'Job Flip', 'lead')
returning id as acct_job \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct_job'::uuid, '12 Oak', 'Springfield', 'IL', '62704')
returning id as prop_job \gset
select public.quote_create(:'acct_job'::uuid, :'prop_job'::uuid, 'Job flip quote') as q_job \gset
select public.quote_current_version(:'q_job'::uuid) as vid_job \gset
insert into public.quote_line_items (org_id, version_id, name, state, price, hours, sort)
values (:'org'::uuid, :'vid_job'::uuid, 'Mow', 'included', 40, 0.5, 0);
select public.quote_send(:'q_job'::uuid) as tok_job \gset
select tests.authenticate_anon();
select public.quote_accept(
  :'tok_job'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua', null, null
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
update public.accounts set status = 'lead' where id = :'acct_job'::uuid;
select is(
  (select status::text from public.accounts where id = :'acct_job'::uuid),
  'lead',
  'office can mark the account lead again before conversion'
);
select (timezone('America/Chicago', now()))::date as today \gset
select public.convert_accepted_quote(
  :'q_job'::uuid, 'one_time', null, null, :'today'::date
) as converted \gset
select ok(
  (:'converted'::jsonb ? 'agreement_id') and (:'converted'::jsonb ? 'job_id'),
  'conversion creates an agreement and job'
);
select is(
  (select status::text from public.accounts where id = :'acct_job'::uuid),
  'active',
  'agreement/job creation flips lead to active'
);

-- A job created without an agreement also activates a lead (property → account).
insert into public.accounts (org_id, name, status)
values (:'org'::uuid, 'Bare Job Flip', 'lead')
returning id as acct_bare \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct_bare'::uuid, '13 Oak', 'Springfield', 'IL', '62704')
returning id as prop_bare \gset
-- Jobs have no direct insert policy; fixtures write as the table owner.
select tests.clear_auth();
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop_bare'::uuid, 'One-off stop');
select is(
  (select status::text from public.accounts where id = :'acct_bare'::uuid),
  'active',
  'creating a job flips lead to active'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select * from finish();
