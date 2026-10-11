-- L15 (#130): retention purge — spam 30d, lost/unconverted 365d, keep converted + aggregates.

select plan(13);

select ok(
  not has_function_privilege('anon', 'public.purge_expired_leads()', 'execute'),
  'anon has no execute on purge_expired_leads'
);
select ok(
  not has_function_privilege('authenticated', 'public.purge_expired_leads()', 'execute'),
  'authenticated has no execute on purge_expired_leads'
);
select ok(
  has_function_privilege('service_role', 'public.purge_expired_leads()', 'execute'),
  'service_role can execute purge_expired_leads'
);

select tests.create_user('purge-owner@example.com', 'Purge Owner') as owner \gset
select tests.create_org('Purge Co', 'purge-co', :'owner'::uuid) as org \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

-- 31-day spam → purge
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, created_at, updated_at
) values (
  :'org'::uuid, 'Spam Old', '+15550000031', '31 Spam St',
  'spam', now() - interval '31 days', now() - interval '31 days'
) returning id as spam_old \gset

-- 29-day spam → keep
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, created_at, updated_at
) values (
  :'org'::uuid, 'Spam New', '+15550000029', '29 Spam St',
  'spam', now() - interval '29 days', now() - interval '29 days'
) returning id as spam_new \gset

-- Converted (won) older than 365d → keep
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, created_at, updated_at
) values (
  :'org'::uuid, 'Won Old', '+15550000365', '365 Won St',
  'won', now() - interval '400 days', now() - interval '400 days'
) returning id as won_old \gset

-- Converted via account link, status still new, older than 365d → keep
insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Converted Acct')
returning id as acct \gset

insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, account_id,
  created_at, updated_at
) values (
  :'org'::uuid, 'Linked Lead', '+15550000366', '366 Link St',
  'new', :'acct'::uuid,
  now() - interval '400 days', now() - interval '400 days'
) returning id as linked_old \gset

-- Lost older than 365d → purge
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, lost_reason,
  created_at, updated_at
) values (
  :'org'::uuid, 'Lost Old', '+15550000367', '367 Lost St',
  'lost', 'price',
  now() - interval '366 days', now() - interval '366 days'
) returning id as lost_old \gset

-- Never-converted (new) older than 365d → purge
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, created_at, updated_at
) values (
  :'org'::uuid, 'Stale New', '+15550000368', '368 New St',
  'new', now() - interval '366 days', now() - interval '366 days'
) returning id as new_old \gset

-- Activity on a doomed spam row (must cascade on purge)
insert into public.lead_activities (
  org_id, lead_request_id, kind, summary, actor_id
) values (
  :'org'::uuid, :'spam_old'::uuid, 'created', 'Spam created', :'owner'::uuid
);

-- Snapshot aggregate total before purge (should be 0 rows / 0 count)
select coalesce(sum(purged_count), 0)::integer as agg_before
from public.lead_retention_aggregates
where org_id = :'org'::uuid
\gset

select tests.clear_auth();
select set_config('role', 'service_role', true);

select public.purge_expired_leads() as purged_n \gset

select ok(
  :'purged_n'::integer >= 3,
  'purge removes at least spam+lost+unconverted overdue rows'
);

select is(
  (select count(*)::integer from public.lead_requests where id = :'spam_old'::uuid),
  0,
  '31-day spam purged'
);

select is(
  (select count(*)::integer from public.lead_requests where id = :'spam_new'::uuid),
  1,
  '29-day spam kept'
);

select is(
  (select count(*)::integer from public.lead_requests where id = :'won_old'::uuid),
  1,
  'converted won lead kept'
);

select is(
  (select count(*)::integer from public.lead_requests where id = :'linked_old'::uuid),
  1,
  'converted linked lead kept'
);

select is(
  (select count(*)::integer from public.lead_requests where id = :'lost_old'::uuid),
  0,
  'lost older than 365 days purged'
);

select is(
  (select count(*)::integer from public.lead_requests where id = :'new_old'::uuid),
  0,
  'never-converted older than 365 days purged'
);

select is(
  (select count(*)::integer from public.lead_activities where lead_request_id = :'spam_old'::uuid),
  0,
  'activities cascade when lead is purged'
);

select coalesce(sum(purged_count), 0)::integer as agg_after
from public.lead_retention_aggregates
where org_id = :'org'::uuid
\gset

select ok(
  :'agg_after'::integer >= 3 and :'agg_after'::integer > :'agg_before'::integer,
  'aggregate counts recorded for purged leads'
);

-- Second run: no more deletes; aggregates unchanged
select public.purge_expired_leads() as purged_again \gset
select coalesce(sum(purged_count), 0)::integer as agg_again
from public.lead_retention_aggregates
where org_id = :'org'::uuid
\gset

select is(
  :'agg_again'::integer,
  :'agg_after'::integer,
  'aggregate counts unchanged on rerun'
);

select * from finish();
