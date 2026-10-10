-- L12 (#127): stale helper + digest claim idempotency.

select plan(6);

select ok(
  private.lead_is_stale(
    timestamptz '2026-10-01 15:30:00+00',
    date '2026-10-07',
    7
  ) = false,
  'not stale at day 6'
);

select ok(
  private.lead_is_stale(
    timestamptz '2026-10-01 15:30:00+00',
    date '2026-10-08',
    7
  ) = true,
  'stale at day 7'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_lead_follow_up_digest(uuid, uuid, date)',
    'execute'
  ),
  'authenticated cannot claim digests'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_lead_follow_up_digest(uuid, uuid, date)',
    'execute'
  ),
  'service_role can claim digests'
);

select tests.create_user('digest-owner@example.com', 'Digest Owner') as owner \gset
select tests.create_user('digest-assignee@example.com', 'Digest Assignee') as assignee \gset
select tests.create_org('Digest Co', 'digest-co', :'owner'::uuid) as org \gset

-- claim_lead_follow_up_digest rejects JWT members; clear auth like nightly cron.
select tests.clear_auth();
select set_config('role', 'service_role', true);

select ok(
  public.claim_lead_follow_up_digest(:'org'::uuid, :'assignee'::uuid, date '2026-10-10') = true,
  'first claim succeeds'
);

select ok(
  public.claim_lead_follow_up_digest(:'org'::uuid, :'assignee'::uuid, date '2026-10-10') = false,
  'rerun claim is a no-op'
);

select * from finish();
