-- S17: visit time corrections with audit and flags (#97).
-- Sync rejects correction without reason; raw times are immutable;
-- over-budget and clock-off flags are set from effective times.

select plan(24);

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

select has_column('public', 'visits', 'raw_started_at', 'visits.raw_started_at exists');
select has_column('public', 'visits', 'raw_completed_at', 'visits.raw_completed_at exists');
select has_column('public', 'visits', 'over_budget', 'visits.over_budget exists');
select has_column('public', 'visits', 'clock_off', 'visits.clock_off exists');
select has_table('public', 'visit_time_corrections', 'visit_time_corrections exists');

select tests.create_user('s17-owner@example.com', 'S17 Owner') as owner \gset
select tests.create_user('s17-lead@example.com', 'S17 Lead') as lead \gset
select tests.create_user('s17-dispatch@example.com', 'S17 Dispatch') as dispatcher \gset
select tests.create_org('S17 Co', 's17-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;
select private.org_local_today(:'org'::uuid) as today \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (:'org'::uuid, 'S17 Account', '555-0170', 's17@example.com', 'bill@example.com', '1 Bill St')
returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '17 Time St', 'Springfield', 'IL', '62701')
returning id as prop \gset
select tests.clear_auth();

insert into public.crews (org_id, name)
values (:'org'::uuid, 'S17 Crew')
returning id as crew \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew'::uuid, :'lead'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew'::uuid;
insert into public.jobs (org_id, property_id, title, status)
values (:'org'::uuid, :'prop'::uuid, 'Time correction stop', 'scheduled')
returning id as job \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew'::uuid, :'today'::date, 'published')
returning id as route \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date,
  status, budget_minutes, sort
) values (
  :'org'::uuid, :'job'::uuid, :'prop'::uuid, :'route'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 30, 1
) returning id as visit \gset

-- Finish the visit so there are raw device times to protect.
-- 20 minutes on site — under the 30-minute budget until office stretches it.
select (pg_catalog.now() - interval '25 minutes') as t_start \gset
select (pg_catalog.now() - interval '5 minutes') as t_finish \gset
select gen_random_uuid() as client_photo \gset
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select lives_ok(
  format(
    $$ select tests.apply_crew('visit_start', %L, gen_random_uuid(), %L::timestamptz, %L::timestamptz, '{}') $$,
    :'visit', :'t_start', :'t_start'
  ),
  'lead can start the visit'
);
select tests.clear_auth();
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit' || '/' || :'client_photo' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select lives_ok(
  format(
    $$ select tests.apply_crew(
         'visit_photo_record', %L, %L::uuid, %L::timestamptz, %L::timestamptz,
         jsonb_build_object('photo_kind', 'after', 'taken_at', %L::timestamptz)
       ) $$,
    :'visit', :'client_photo', :'t_finish', :'t_finish', :'t_finish'
  ),
  'lead can record the after photo'
);
select lives_ok(
  format(
    $$ select tests.apply_crew('visit_finish', %L, gen_random_uuid(), %L::timestamptz, %L::timestamptz, '{}') $$,
    :'visit', :'t_finish', :'t_finish'
  ),
  'lead can finish the visit'
);

select isnt(
  (select raw_started_at from public.visits where id = :'visit'::uuid),
  null::timestamptz,
  'raw_started_at is captured on start'
);
select isnt(
  (select raw_completed_at from public.visits where id = :'visit'::uuid),
  null::timestamptz,
  'raw_completed_at is captured on finish'
);

select (select raw_started_at from public.visits where id = :'visit'::uuid) as raw_start \gset
select (select raw_completed_at from public.visits where id = :'visit'::uuid) as raw_finish \gset
select (select started_at from public.visits where id = :'visit'::uuid) as eff_start \gset
select (select completed_at from public.visits where id = :'visit'::uuid) as eff_finish \gset

-- Sync test: correction without reason rejected.
select is(
  (
    public.crew_sync(jsonb_build_array(jsonb_build_object(
      'client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'kind', 'visit_correct_times',
      'visit_id', :'visit',
      'occurred_at', pg_catalog.now(),
      'device_now', pg_catalog.now(),
      'payload', jsonb_build_object(
        'started_at', :'eff_start',
        'completed_at', (:'eff_finish'::timestamptz - interval '5 minutes')
      )
    )))->'results'->0->>'status'
  ),
  'error',
  'sync rejects a time correction without a reason'
);
select ok(
  (
    public.crew_sync(jsonb_build_array(jsonb_build_object(
      'client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'kind', 'visit_correct_times',
      'visit_id', :'visit',
      'occurred_at', pg_catalog.now(),
      'device_now', pg_catalog.now(),
      'payload', jsonb_build_object(
        'started_at', :'eff_start',
        'completed_at', (:'eff_finish'::timestamptz - interval '5 minutes'),
        'reason', '   '
      )
    )))->'results'->0->>'message'
  ) ilike '%reason%',
  'sync error message mentions reason for blank reason'
);

-- Correction with reason applies, writes audit, leaves raw times alone.
select (:'eff_finish'::timestamptz - interval '5 minutes') as new_finish \gset
select is(
  (
    public.crew_sync(jsonb_build_array(jsonb_build_object(
      'client_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'kind', 'visit_correct_times',
      'visit_id', :'visit',
      'occurred_at', pg_catalog.now(),
      'device_now', pg_catalog.now(),
      'payload', jsonb_build_object(
        'started_at', :'eff_start',
        'completed_at', :'new_finish',
        'reason', 'Forgot to stop the timer at the gate'
      )
    )))->'results'->0->>'status'
  ),
  'applied',
  'sync applies a time correction with a reason'
);

select is(
  (select completed_at from public.visits where id = :'visit'::uuid),
  :'new_finish'::timestamptz,
  'effective completed_at updates after correction'
);
select is(
  (select raw_started_at from public.visits where id = :'visit'::uuid),
  :'raw_start'::timestamptz,
  'raw_started_at stays the original device time'
);
select is(
  (select raw_completed_at from public.visits where id = :'visit'::uuid),
  :'raw_finish'::timestamptz,
  'raw_completed_at stays the original device time'
);
select ok(
  (select clock_off from public.visits where id = :'visit'::uuid),
  'clock_off is set when effective times differ from raw'
);
-- Office can read the audit; crew_lead cannot (RLS).
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select ok(
  exists (
    select 1 from public.visit_time_corrections c
    where c.visit_id = :'visit'::uuid
      and c.corrected_by = :'lead'::uuid
      and c.reason = 'Forgot to stop the timer at the gate'
      and c.old_completed_at = :'eff_finish'::timestamptz
      and c.new_completed_at = :'new_finish'::timestamptz
  ),
  'audit stores old/new/who/reason for the crew correction'
);

-- pgTAP: raw times not updatable (table owner / trigger, not column grants).
select tests.clear_auth();
select throws_ok(
  format(
    $$ update public.visits set raw_started_at = %L::timestamptz - interval '1 minute' where id = %L $$,
    :'raw_start', :'visit'
  ),
  '42501',
  null,
  'raw_started_at cannot be updated once set'
);
select throws_ok(
  format(
    $$ update public.visits set raw_completed_at = %L::timestamptz - interval '1 minute' where id = %L $$,
    :'raw_finish', :'visit'
  ),
  '42501',
  null,
  'raw_completed_at cannot be updated once set'
);

-- DB test: over-budget flag when corrected duration exceeds budget_minutes.
-- budget is 30 min; stretch finish so wall time is over budget.
select (:'eff_start'::timestamptz + interval '45 minutes') as over_finish \gset
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format(
    $$ select public.office_correct_visit_times(%L::uuid, %L::timestamptz, %L::timestamptz, %L) $$,
    :'visit', :'eff_start', :'over_finish', 'Office adjusted after review'
  ),
  'office can edit visit times with a reason'
);
select ok(
  (select over_budget from public.visits where id = :'visit'::uuid),
  'over_budget is set when effective duration exceeds budget_minutes'
);
select ok(
  exists (
    select 1 from public.visit_time_corrections c
    where c.visit_id = :'visit'::uuid
      and c.source = 'office'
      and c.corrected_by = :'dispatcher'::uuid
      and c.reason = 'Office adjusted after review'
      and c.new_completed_at = :'over_finish'::timestamptz
  ),
  'office edit writes an audit row with who and reason'
);
select is(
  (select raw_completed_at from public.visits where id = :'visit'::uuid),
  :'raw_finish'::timestamptz,
  'office edit leaves raw_completed_at unchanged'
);

select * from finish();
