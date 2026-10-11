-- L17 (#132) follow-up: speed-to-lead median + conversion by source; crew denied.

select plan(6);

select tests.create_user('l17-owner@example.com', 'L17 Owner') as owner \gset
select tests.create_user('l17-sales@example.com', 'L17 Sales') as sales \gset
select tests.create_user('l17-crew@example.com', 'L17 Crew') as crew \gset
select tests.create_org('L17', 'l17', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

-- Google: responses 30m + 60m → median 45m; 1 of 3 converted (status quoted)
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, source, status,
  created_at, first_contacted_at
) values
(
  :'org'::uuid, 'G1', '+15551110001', '1 Google St', 'Google', 'quoted',
  '2026-10-01 10:00:00+00', '2026-10-01 10:30:00+00'
),
(
  :'org'::uuid, 'G2', '+15551110002', '2 Google St', 'Google', 'contacted',
  '2026-10-02 10:00:00+00', '2026-10-02 11:00:00+00'
),
(
  :'org'::uuid, 'G3', '+15551110003', '3 Google St', 'Google', 'new',
  '2026-10-03 10:00:00+00', null
);

-- Referral: 15m + 45m → median 30m; both converted (won)
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, source, status,
  created_at, first_contacted_at
) values
(
  :'org'::uuid, 'R1', '+15551110004', '1 Ref St', 'Referral', 'won',
  '2026-10-01 10:00:00+00', '2026-10-01 10:15:00+00'
),
(
  :'org'::uuid, 'R2', '+15551110005', '2 Ref St', 'Referral', 'won',
  '2026-10-04 10:00:00+00', '2026-10-04 10:45:00+00'
);

-- Spam excluded from report
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, source, status,
  created_at, first_contacted_at
) values (
  :'org'::uuid, 'Spam', '+15551110006', '9 Spam St', 'Google', 'spam',
  '2026-10-05 10:00:00+00', '2026-10-05 10:05:00+00'
);

-- Median response ms by source (first_contacted_at - created_at), non-spam only
create temporary view l17_source_stats as
select
  coalesce(nullif(btrim(source), ''), '(none)') as source,
  count(*)::bigint as lead_count,
  count(*) filter (where first_contacted_at is not null)::bigint as contacted_count,
  count(*) filter (
    where status in ('quoted', 'won')
       or quote_id is not null
       or account_id is not null
  )::bigint as converted_count,
  percentile_cont(0.5) within group (
    order by extract(epoch from (first_contacted_at - created_at)) * 1000
  ) filter (where first_contacted_at is not null) as median_response_ms
from public.lead_requests
where org_id = :'org'::uuid
  and status <> 'spam'
group by 1;

select is(
  (select median_response_ms::numeric from l17_source_stats where source = 'Google'),
  (45 * 60 * 1000)::numeric,
  'median response for Google is 45 minutes from first_contacted_at'
);

select is(
  (select median_response_ms::numeric from l17_source_stats where source = 'Referral'),
  (30 * 60 * 1000)::numeric,
  'median response for Referral is 30 minutes from first_contacted_at'
);

select is(
  (
    select round(converted_count::numeric / lead_count, 6)
    from l17_source_stats
    where source = 'Google'
  ),
  round((1::numeric) / 3, 6),
  'Google conversion rate is 1/3 (quoted among non-spam)'
);

select is(
  (
    select round(converted_count::numeric / lead_count, 6)
    from l17_source_stats
    where source = 'Referral'
  ),
  1::numeric,
  'Referral conversion rate is 100%'
);

select is(
  (select count(*) from l17_source_stats where source = 'Google' and lead_count = 3),
  1::bigint,
  'spam Google lead excluded from source rollup'
);

-- Crew denied: zero lead rows for the report source table
select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from public.lead_requests where org_id = :'org'::uuid),
  0::bigint,
  'crew denied: zero lead_requests rows for speed-to-lead source data'
);

select tests.clear_auth();
select finish();
