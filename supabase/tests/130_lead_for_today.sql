-- S09: lead for today and lead-at-time validation on crew_sync.

select plan(19);

create or replace function tests.apply_crew(
  p_kind text,
  p_visit uuid,
  p_client uuid,
  p_occurred timestamptz,
  p_device timestamptz,
  p_payload jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.crew_apply(p_kind, p_visit, p_client, p_occurred, p_device, p_payload);
end;
$$;

revoke all on function tests.apply_crew(text, uuid, uuid, timestamptz, timestamptz, jsonb) from public;
grant execute on function tests.apply_crew(text, uuid, uuid, timestamptz, timestamptz, jsonb) to authenticated;

select has_table('public', 'crew_lead_sessions', 'crew_lead_sessions exists');
select ok(
  has_function_privilege('authenticated', 'public.set_lead_for_today(uuid,date,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.claim_lead_for_today(uuid,date)', 'execute')
  and not has_function_privilege('anon', 'public.set_lead_for_today(uuid,date,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.claim_lead_for_today(uuid,date)', 'execute'),
  'lead-for-today RPCs are granted to authenticated only'
);

select tests.create_user('s09-owner@example.com', 'S09 Owner') as owner \gset
select tests.create_user('s09-dispatch@example.com', 'S09 Dispatch') as dispatcher \gset
select tests.create_user('s09-lead@example.com', 'S09 Lead') as lead \gset
select tests.create_user('s09-sub@example.com', 'S09 Sub') as sub \gset
select tests.create_user('s09-hand@example.com', 'S09 Hand') as hand \gset

select tests.create_org('S09', 's09-lead', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'sub'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'hand'::uuid, 'crew');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date - 1) as yesterday \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'S09 Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '12 Lead Ln', 'Springfield', 'IL', '62704')
returning id as prop \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Mow') returning id as job \gset

insert into public.crews (org_id, name) values (:'org'::uuid, 'Truck') returning id as crew \gset
insert into public.crew_members (org_id, crew_id, profile_id) values
  (:'org'::uuid, :'crew'::uuid, :'lead'::uuid),
  (:'org'::uuid, :'crew'::uuid, :'sub'::uuid),
  (:'org'::uuid, :'crew'::uuid, :'hand'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew'::uuid;

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew'::uuid, :'today'::date, 'published')
returning id as route \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, budget_minutes, sort
) values (
  :'org'::uuid, :'job'::uuid, :'prop'::uuid, :'route'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 40, 1
) returning id as visit \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format(
    $$ select public.set_lead_for_today(%L::uuid, %L::date, %L::uuid) $$,
    :'crew', :'yesterday', :'sub'
  ),
  'office can set lead for yesterday'
);
select tests.authenticate_as(:'sub'::uuid, :'org'::uuid, 'crew_lead');
select is(
  private.was_crew_lead_at(
    :'org'::uuid, :'crew'::uuid, :'today'::date, pg_catalog.now()
  ),
  false,
  'a lead session on another date does not count'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format(
    $$ select public.set_lead_for_today(%L::uuid, %L::date, %L::uuid) $$,
    :'crew', :'today', :'lead'
  ),
  'office can set lead for today'
);

select (pg_catalog.now() - interval '10 minutes') as t_start \gset
select (pg_catalog.now() - interval '5 minutes') as t_note \gset

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_start', :'visit'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
    :'t_start'::timestamptz, :'t_start'::timestamptz, '{}'::jsonb
  ),
  'applied',
  'the lead for today can start a visit'
);
select is(
  (select status::text from public.visits where id = :'visit'::uuid),
  'in_progress',
  'the visit is in progress after start'
);
select is(
  (
    select count(*) from public.time_entries
    where visit_id = :'visit'::uuid and ended_at is null and kind = 'job'
  ),
  1::bigint,
  'start opens one job timer'
);
select started_at as timer_started
from public.time_entries
where visit_id = :'visit'::uuid and ended_at is null
\gset

select tests.authenticate_as(:'sub'::uuid, :'org'::uuid, 'crew_lead');
select lives_ok(
  format($$ select public.claim_lead_for_today(%L::uuid, %L::date) $$, :'crew', :'today'),
  'a sub can claim lead for today'
);
select is(
  (
    select count(*) from public.crew_lead_sessions
    where org_id = :'org'::uuid and crew_id = :'crew'::uuid
      and route_date = :'today'::date and ended_at is null
  ),
  1::bigint,
  'one active lead session after the sub claims'
);
select is(
  (
    select lead_id from public.crew_lead_sessions
    where org_id = :'org'::uuid and crew_id = :'crew'::uuid
      and route_date = :'today'::date and ended_at is null
  ),
  :'sub'::uuid,
  'the open session belongs to the sub'
);

-- Sync: previous lead queued action still applies at the earlier lead time.
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  (
    public.crew_sync(jsonb_build_array(jsonb_build_object(
      'client_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'kind', 'visit_set_note',
      'visit_id', :'visit',
      'occurred_at', :'t_note',
      'device_now', :'t_note',
      'payload', jsonb_build_object('note', 'queued while lead')
    )))->'results'->0->>'status'
  ),
  'applied',
  'sync accepts the previous lead action at the earlier lead time'
);

-- Sync: non-lead start/finish rejected.
select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select is(
  (
    public.crew_sync(jsonb_build_array(jsonb_build_object(
      'client_id', 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      'kind', 'visit_start',
      'visit_id', :'visit',
      'occurred_at', pg_catalog.now(),
      'device_now', pg_catalog.now(),
      'payload', '{}'::jsonb
    )))->'results'->0->>'status'
  ),
  'error',
  'sync rejects a non-lead start'
);
select is(
  (
    public.crew_sync(jsonb_build_array(jsonb_build_object(
      'client_id', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'kind', 'visit_finish',
      'visit_id', :'visit',
      'occurred_at', pg_catalog.now(),
      'device_now', pg_catalog.now(),
      'payload', '{}'::jsonb
    )))->'results'->0->>'status'
  ),
  'error',
  'sync rejects a non-lead finish'
);
select is(
  (select status::text from public.visits where id = :'visit'::uuid),
  'in_progress',
  'a rejected non-lead finish leaves the visit in progress'
);

-- Sync: swap preserves timer; new lead finishes after after-photo.
select is(
  (
    select started_at from public.time_entries
    where visit_id = :'visit'::uuid and ended_at is null and kind = 'job'
  ),
  :'timer_started'::timestamptz,
  'swap preserves the open timer start'
);

select tests.clear_auth();
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit' || '/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1.jpg');
select tests.authenticate_as(:'sub'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit'::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid,
    pg_catalog.now(), pg_catalog.now(),
    jsonb_build_object('photo_kind', 'after', 'taken_at', pg_catalog.now())
  ),
  'applied',
  'the new lead can record the after photo'
);
select is(
  (
    public.crew_sync(jsonb_build_array(jsonb_build_object(
      'client_id', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
      'kind', 'visit_finish',
      'visit_id', :'visit',
      'occurred_at', pg_catalog.now(),
      'device_now', pg_catalog.now(),
      'payload', '{}'::jsonb
    )))->'results'->0->>'status'
  ),
  'applied',
  'the new lead can finish after the swap'
);
select is(
  (select status::text from public.visits where id = :'visit'::uuid),
  'completed',
  'the new lead finish completes the visit'
);

select * from finish();
