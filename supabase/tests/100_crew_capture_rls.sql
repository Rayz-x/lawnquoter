-- Crew capture tables, the visit-photos bucket, completion rules, and the
-- live crew-lead check. Quote price denial stays in the privilege-gaps tests.

select plan(106);

select has_table('public', 'time_entries', 'time_entries exists');
select has_table('public', 'visit_photos', 'visit_photos exists');
select has_table('public', 'enhancement_requests', 'enhancement_requests exists');
select has_table('public', 'visit_events', 'visit_events exists');
select has_column('public', 'visits', 'completed_after_cancel', 'completed_after_cancel exists');
select col_not_null('public', 'visits', 'completed_after_cancel', 'completed_after_cancel is required');
select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'time_entries', 'visit_photos', 'enhancement_requests', 'visit_events'
      )
      and column_name in (
        'price', 'cost', 'margin', 'amount', 'phone', 'email', 'billing_email'
      )
  ),
  0::bigint,
  'crew capture tables have no price, cost, or contact columns'
);
select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'visits'
      and column_name = 'require_after_photo'
  ),
  0::bigint,
  'after photos are required on every visit, with no per-service switch'
);
select results_eq(
  $$ select file_size_limit, public from storage.buckets where id = 'visit-photos' $$,
  $$ values (460800::bigint, false) $$,
  'visit-photos is private and limited to 450 KiB'
);
select ok(
  (
    select allowed_mime_types = array['image/jpeg']::text[]
    from storage.buckets
    where id = 'visit-photos'
  ),
  'visit-photos allows only jpeg'
);
select is(
  (
    select count(*)
    from pg_trigger
    where tgname = 'visits_reject_completed'
      and not tgisinternal
  ),
  0::bigint,
  'the visit reject-completed trigger is replaced'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'jobs_reject_completed'
      and not tgisinternal
  ),
  'jobs still use the reject-completed trigger'
);

select ok(
  not has_function_privilege('anon', 'private.is_live_crew_lead(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'private.is_live_crew_lead(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'private.is_live_crew_lead(uuid, uuid)', 'execute'),
  'is_live_crew_lead is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.visit_photo_path_parts(text)', 'execute')
  and has_function_privilege('authenticated', 'private.visit_photo_path_parts(text)', 'execute')
  and has_function_privilege('service_role', 'private.visit_photo_path_parts(text)', 'execute'),
  'visit_photo_path_parts is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.visit_photo_crew(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'private.visit_photo_crew(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'private.visit_photo_crew(uuid, uuid)', 'execute'),
  'visit_photo_crew is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.can_write_visit_photo(text)', 'execute')
  and has_function_privilege('authenticated', 'private.can_write_visit_photo(text)', 'execute')
  and has_function_privilege('service_role', 'private.can_write_visit_photo(text)', 'execute'),
  'can_write_visit_photo is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.can_read_visit_photo(text)', 'execute')
  and has_function_privilege('authenticated', 'private.can_read_visit_photo(text)', 'execute')
  and has_function_privilege('service_role', 'private.can_read_visit_photo(text)', 'execute'),
  'can_read_visit_photo is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.time_entries_before_write()', 'execute')
  and has_function_privilege('authenticated', 'private.time_entries_before_write()', 'execute')
  and has_function_privilege('service_role', 'private.time_entries_before_write()', 'execute'),
  'time_entries_before_write is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.enhancement_requests_before_write()', 'execute')
  and has_function_privilege('authenticated', 'private.enhancement_requests_before_write()', 'execute')
  and has_function_privilege('service_role', 'private.enhancement_requests_before_write()', 'execute'),
  'enhancement_requests_before_write is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.visit_events_append_only()', 'execute')
  and has_function_privilege('authenticated', 'private.visit_events_append_only()', 'execute')
  and has_function_privilege('service_role', 'private.visit_events_append_only()', 'execute'),
  'visit_events_append_only is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.visit_photos_keep_after()', 'execute')
  and has_function_privilege('authenticated', 'private.visit_photos_keep_after()', 'execute')
  and has_function_privilege('service_role', 'private.visit_photos_keep_after()', 'execute'),
  'visit_photos_keep_after is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.visits_guard_status()', 'execute')
  and has_function_privilege('authenticated', 'private.visits_guard_status()', 'execute')
  and has_function_privilege('service_role', 'private.visits_guard_status()', 'execute'),
  'visits_guard_status is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.routes_one_active_visit()', 'execute')
  and has_function_privilege('authenticated', 'private.routes_one_active_visit()', 'execute')
  and has_function_privilege('service_role', 'private.routes_one_active_visit()', 'execute'),
  'routes_one_active_visit is granted to authenticated and service_role'
);

select tests.create_user('cap-owner@example.com', 'Cap Owner') as owner \gset
select tests.create_user('cap-other@example.com', 'Cap Other') as other \gset
select tests.create_user('cap-dispatch@example.com', 'Cap Dispatch') as dispatcher \gset
select tests.create_user('cap-lead@example.com', 'Cap Lead') as lead \gset
select tests.create_user('cap-hand@example.com', 'Cap Hand') as hand \gset
select tests.create_user('cap-south@example.com', 'Cap South') as south \gset

select tests.create_org('Capture', 'capture', :'owner'::uuid) as org \gset
select tests.create_org('Other Capture', 'capture-other', :'other'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'hand'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'south'::uuid, 'crew');

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date + 1) as tomorrow \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Pat Customer')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1503 Larkspur', 'Springfield', 'IL', '62704')
returning id as prop \gset

insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Stop A')
returning id as job_a \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Stop B')
returning id as job_b \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Stop C')
returning id as job_c \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Stop D')
returning id as job_d \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Stop E')
returning id as job_e \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Stop F')
returning id as job_f \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Spare')
returning id as job_spare \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Cascade')
returning id as job_cascade \gset

insert into public.crews (org_id, name) values (:'org'::uuid, 'North') returning id as crew_north \gset
insert into public.crews (org_id, name) values (:'org'::uuid, 'South') returning id as crew_south \gset
insert into public.crews (org_id, name) values (:'org'::uuid, 'Spare') returning id as crew_spare \gset
insert into public.crew_members (org_id, crew_id, profile_id) values
  (:'org'::uuid, :'crew_north'::uuid, :'lead'::uuid),
  (:'org'::uuid, :'crew_north'::uuid, :'hand'::uuid),
  (:'org'::uuid, :'crew_south'::uuid, :'south'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew_north'::uuid;

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_north'::uuid, :'today'::date, 'published')
returning id as route_north \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_south'::uuid, :'today'::date, 'published')
returning id as route_south \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_spare'::uuid, :'tomorrow'::date, 'published')
returning id as route_spare \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_a'::uuid, :'prop'::uuid, :'route_north'::uuid, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_a \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_b'::uuid, :'prop'::uuid, :'route_north'::uuid, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_b \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_c'::uuid, :'prop'::uuid, :'route_north'::uuid, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_c \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_d'::uuid, :'prop'::uuid, :'route_north'::uuid, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_d \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_e'::uuid, :'prop'::uuid, :'route_north'::uuid, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_e \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_f'::uuid, :'prop'::uuid, :'route_south'::uuid, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_f \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_spare'::uuid, :'prop'::uuid, :'route_spare'::uuid, :'tomorrow'::date, :'tomorrow'::date, 'scheduled'
) returning id as visit_spare \gset
insert into public.visits (
  org_id, job_id, property_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_cascade'::uuid, :'prop'::uuid, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_cascade \gset

select gen_random_uuid() as client_before \gset
select gen_random_uuid() as client_after_a \gset
select gen_random_uuid() as client_after_b \gset
select gen_random_uuid() as client_issue \gset
select gen_random_uuid() as client_after_c \gset
select gen_random_uuid() as client_object \gset
select gen_random_uuid() as client_object_2 \gset

select throws_ok(
  format($$ update public.jobs set status = 'completed' where id = %L $$, :'job_a'),
  '22023',
  null,
  'a job still cannot be completed'
);
select throws_ok(
  format(
    $$ insert into public.visits (org_id, job_id, property_id, occurrence_date, status)
       values (%L, %L, %L, %L, 'completed') $$,
    :'org', :'job_a', :'prop', :'tomorrow'
  ),
  '22023',
  null,
  'a visit cannot be inserted already completed'
);
select throws_ok(
  format($$ update public.visits set status = 'completed' where id = %L $$, :'visit_a'),
  '22023',
  null,
  'a visit cannot be completed before an after photo exists'
);

select lives_ok(
  format(
    $$ insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
       values (%L, %L, 'before', %L || '/' || %L || '/' || %L || '.jpg', now(), %L) $$,
    :'org', :'visit_a', :'org', :'visit_a', :'client_before', :'client_before'
  ),
  'a before photo can be stored'
);
select throws_ok(
  format($$ update public.visits set status = 'completed' where id = %L $$, :'visit_a'),
  '22023',
  null,
  'a before photo does not satisfy completion'
);

select lives_ok(
  format(
    $$ insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
       values (%L, %L, 'after', %L || '/' || %L || '/' || %L || '.jpg', now(), %L)
       returning id $$,
    :'org', :'visit_a', :'org', :'visit_a', :'client_after_a', :'client_after_a'
  ),
  'an after photo can be stored'
);
select lives_ok(
  format($$ update public.visits set status = 'completed' where id = %L $$, :'visit_a'),
  'an after photo lets the visit be completed'
);
select is(
  (select status::text from public.visits where id = :'visit_a'::uuid),
  'completed',
  'the visit is completed'
);
select is(
  (select completed_after_cancel from public.visits where id = :'visit_a'::uuid),
  false,
  'a normal completion is not flagged'
);
select ok(
  (select completed_at is not null from public.visits where id = :'visit_a'::uuid),
  'completing a visit records completed_at'
);

update public.visits set status = 'cancelled' where id = :'visit_a'::uuid;
select is(
  (select status::text from public.visits where id = :'visit_a'::uuid),
  'completed',
  'cancelling a completed visit keeps the completion'
);
select is(
  (select completed_after_cancel from public.visits where id = :'visit_a'::uuid),
  true,
  'cancelling a completed visit flags it'
);
select is(
  (select count(*) from public.visit_office_notes where visit_id = :'visit_a'::uuid),
  0::bigint,
  'a direct cancel does not invent an office note'
);

select lives_ok(
  format(
    $$ insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
       values (%L, %L, 'after', %L || '/' || %L || '/' || %L || '.jpg', now(), %L) $$,
    :'org', :'visit_b', :'org', :'visit_b', :'client_after_b', :'client_after_b'
  ),
  'visit B can store its after photo'
);
select lives_ok(
  format($$ update public.visits set status = 'completed' where id = %L $$, :'visit_b'),
  'visit B can be completed'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format($$ select public.cancel_visit(%L, 'customer called') $$, :'visit_b'),
  '42501',
  null,
  'a crew lead cannot cancel a visit'
);
select is(
  (select completed_after_cancel from public.visits where id = :'visit_b'::uuid),
  false,
  'a refused crew cancel does not flag the visit'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format($$ select public.cancel_visit(%L, 'customer called') $$, :'visit_b'),
  'the office can cancel after the crew completed'
);
select lives_ok(
  format($$ select public.cancel_visit(%L, 'customer called again') $$, :'visit_b'),
  'cancelling a flagged completion again is a no-op'
);
select tests.clear_auth();
select is(
  (select status::text from public.visits where id = :'visit_b'::uuid),
  'completed',
  'office cancel keeps the crew completion'
);
select is(
  (select completed_after_cancel from public.visits where id = :'visit_b'::uuid),
  true,
  'office cancel flags the completion'
);
select is(
  (select note from public.visit_office_notes where visit_id = :'visit_b'::uuid),
  'customer called',
  'the office reason is stored once'
);

select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from public.visit_office_notes),
  0::bigint,
  'crew cannot read the office cancel note'
);
select tests.clear_auth();

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format($$ select public.cancel_visit(%L, 'stop pulled') $$, :'visit_c'),
  'the office can cancel a scheduled stop'
);
select tests.clear_auth();
select is(
  (select status::text from public.visits where id = :'visit_c'::uuid),
  'cancelled',
  'a scheduled stop becomes cancelled'
);
select is(
  (select completed_after_cancel from public.visits where id = :'visit_c'::uuid),
  false,
  'a cancel before completion is not flagged as completed after cancel'
);
select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from public.visits where id = :'visit_c'::uuid),
  0::bigint,
  'crew cannot read a cancelled stop'
);
select tests.clear_auth();

select lives_ok(
  format(
    $$ insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
       values (%L, %L, 'issue', %L || '/' || %L || '/' || %L || '.jpg', now(), %L) $$,
    :'org', :'visit_c', :'org', :'visit_c', :'client_issue', :'client_issue'
  ),
  'an issue photo can be stored on a cancelled stop'
);
select throws_ok(
  format($$ update public.visits set status = 'completed' where id = %L $$, :'visit_c'),
  '22023',
  null,
  'an issue photo does not satisfy completion'
);
select lives_ok(
  format(
    $$ insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
       values (%L, %L, 'after', %L || '/' || %L || '/' || %L || '.jpg', now(), %L) $$,
    :'org', :'visit_c', :'org', :'visit_c', :'client_after_c', :'client_after_c'
  ),
  'a late after photo can be stored'
);
select lives_ok(
  format($$ update public.visits set status = 'completed', completed_at = now() where id = %L $$, :'visit_c'),
  'a completion that arrives after cancel is kept'
);
select is(
  (select status::text from public.visits where id = :'visit_c'::uuid),
  'completed',
  'the late completion replaces the cancel'
);
select is(
  (select completed_after_cancel from public.visits where id = :'visit_c'::uuid),
  true,
  'a completion after cancel is flagged'
);
select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from public.visits where id = :'visit_c'::uuid),
  1::bigint,
  'crew can read a stop that was completed after cancel'
);
select tests.clear_auth();

select lives_ok(
  format($$ update public.visits set status = 'in_progress' where id = %L $$, :'visit_d'),
  'the first in-progress visit on a crew is allowed'
);
select throws_ok(
  format($$ update public.visits set status = 'in_progress' where id = %L $$, :'visit_e'),
  '23514',
  null,
  'a second in-progress visit on the same crew is rejected'
);
select lives_ok(
  format($$ update public.visits set status = 'paused' where id = %L $$, :'visit_d'),
  'the active visit can be paused'
);
select throws_ok(
  format($$ update public.visits set status = 'in_progress' where id = %L $$, :'visit_e'),
  '23514',
  null,
  'a paused visit still counts as the crew''s active visit'
);
select lives_ok(
  format($$ update public.visits set status = 'in_progress' where id = %L $$, :'visit_f'),
  'another crew can have its own in-progress visit'
);
select lives_ok(
  format($$ update public.visits set status = 'in_progress' where id = %L $$, :'visit_spare'),
  'a spare crew can have its own in-progress visit'
);
select throws_ok(
  format($$ update public.routes set crew_id = %L where id = %L $$, :'crew_north', :'route_spare'),
  '23514',
  null,
  'a route cannot move onto a crew that already has an active visit'
);

select throws_ok(
  format(
    $$ insert into public.visit_events (org_id, visit_id, kind, occurred_at, payload)
       values (%L, %L, 'started', now(), '{"price": 12}'::jsonb) $$,
    :'org', :'visit_cascade'
  ),
  '23514',
  null,
  'visit events reject a price payload'
);
select lives_ok(
  format(
    $$ insert into public.visit_events (org_id, visit_id, kind, occurred_at, client_id)
       values (%L, %L, 'started', now(), %L) $$,
    :'org', :'visit_cascade', :'client_object'
  ),
  'a visit event can be appended'
);
select throws_ok(
  format(
    $$ update public.visit_events set kind = 'finished' where visit_id = %L $$,
    :'visit_cascade'
  ),
  '42501',
  null,
  'visit events cannot be updated'
);
select throws_ok(
  format($$ delete from public.visit_events where visit_id = %L $$, :'visit_cascade'),
  '42501',
  null,
  'visit events cannot be deleted directly'
);
select lives_ok(
  format($$ delete from public.jobs where id = %L $$, :'job_cascade'),
  'deleting the job removes its visit'
);
select is(
  (select count(*) from public.visit_events where visit_id = :'visit_cascade'::uuid),
  0::bigint,
  'cascading the visit removes its events'
);

select throws_ok(
  format(
    $$ insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
       values (%L, %L, 'after', %L || '/' || %L || '/' || %L || '.jpg', now(), %L) $$,
    :'org', :'visit_b', :'org', :'visit_b', :'client_after_a', :'client_after_a'
  ),
  '23505',
  null,
  'photo client_id is unique per org'
);

select id as photo_a
from public.visit_photos
where client_id = :'client_after_a'::uuid \gset
select id as photo_b
from public.visit_photos
where client_id = :'client_after_b'::uuid \gset

select throws_ok(
  format(
    $$ insert into public.enhancement_requests (org_id, visit_id, property_id, tag, photo_ids)
       values (%L, %L, %L, 'aeration', array[%L]::uuid[]) $$,
    :'org', :'visit_a', :'prop', :'photo_b'
  ),
  '23514',
  null,
  'an enhancement photo must belong to the visit'
);
select lives_ok(
  format(
    $$ insert into public.enhancement_requests (org_id, visit_id, property_id, tag, photo_ids, note)
       values (%L, %L, %L, 'mulch', array[%L]::uuid[], 'beds are thin') $$,
    :'org', :'visit_a', :'prop', :'photo_a'
  ),
  'an enhancement can cite a photo from its visit'
);

select throws_ok(
  format(
    $$ insert into public.time_entries (org_id, crew_id, visit_id, kind, started_at)
       values (%L, %L, %L, 'job', now()) $$,
    :'org', :'crew_south', :'visit_a'
  ),
  '23514',
  null,
  'a time entry cannot name a different crew than the visit'
);
select lives_ok(
  format(
    $$ insert into public.time_entries (org_id, crew_id, visit_id, profile_id, kind, started_at, client_id)
       values (%L, %L, %L, %L, 'job', now(), %L) $$,
    :'org', :'crew_north', :'visit_a', :'lead', :'client_object_2'
  ),
  'the crew lead can be recorded on a time entry'
);
select throws_ok(
  format(
    $$ insert into public.time_entries (org_id, crew_id, visit_id, kind, started_at)
       values (%L, %L, %L, 'pause', now()) $$,
    :'org', :'crew_north', :'visit_a'
  ),
  '23505',
  null,
  'a visit has one open time entry'
);

select throws_ok(
  format($$ delete from public.visit_photos where client_id = %L $$, :'client_after_a'),
  '22023',
  null,
  'a completed visit keeps its after photo'
);

select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from public.time_entries where visit_id = :'visit_a'::uuid),
  1::bigint,
  'crew can read time entries for their visit'
);
select is(
  (select count(*) from public.visit_photos where visit_id = :'visit_a'::uuid),
  2::bigint,
  'crew can read photos for their visit'
);
select is(
  (select count(*) from public.enhancement_requests where visit_id = :'visit_a'::uuid),
  1::bigint,
  'crew can read enhancement requests for their visit'
);
select throws_ok(
  format(
    $$ insert into public.time_entries (org_id, crew_id, visit_id, kind, started_at)
       values (%L, %L, %L, 'job', now()) $$,
    :'org', :'crew_north', :'visit_d'
  ),
  '42501',
  null,
  'crew cannot insert time entries directly'
);
select throws_ok(
  format(
    $$ insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
       values (%L, %L, 'after', %L || '/' || %L || '/' || %L || '.jpg', now(), %L) $$,
    :'org', :'visit_d', :'org', :'visit_d', :'client_object', :'client_object'
  ),
  '42501',
  null,
  'crew cannot insert visit photo rows directly'
);
select throws_ok(
  format(
    $$ insert into public.visit_events (org_id, visit_id, kind, occurred_at)
       values (%L, %L, 'started', now()) $$,
    :'org', :'visit_a'
  ),
  '42501',
  null,
  'crew cannot insert visit events directly'
);

select tests.authenticate_as(:'south'::uuid, :'org'::uuid, 'crew');
select is((select count(*) from public.time_entries), 0::bigint, 'another crew cannot read these time entries');
select is((select count(*) from public.visit_photos where visit_id = :'visit_a'::uuid), 0::bigint, 'another crew cannot read these photos');
select is((select count(*) from public.enhancement_requests), 0::bigint, 'another crew cannot read these enhancement requests');

select tests.authenticate_as(:'other'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.time_entries), 0::bigint, 'another org cannot read time entries');
select is((select count(*) from public.visit_photos), 0::bigint, 'another org cannot read visit photos');
select is((select count(*) from public.visit_events), 0::bigint, 'another org cannot read visit events');

select tests.authenticate_anon();
select throws_ok(
  $$ select count(*) from public.time_entries $$,
  '42501',
  null,
  'anon cannot read time entries'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select ok(
  (select count(*) from public.visit_photos) >= 1,
  'the office can read visit photos'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew');
select is(
  private.is_live_crew_lead(:'org'::uuid, :'crew_north'::uuid),
  true,
  'the live lead passes even when the token says crew'
);
select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew_lead');
select is(
  private.is_live_crew_lead(:'org'::uuid, :'crew_north'::uuid),
  false,
  'a spoofed crew_lead token is not the live lead'
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  private.is_live_crew_lead(:'org'::uuid, :'crew_north'::uuid),
  false,
  'an owner is not the live crew lead'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select lives_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('visit-photos', %L) $$,
    :'org' || '/' || :'visit_a' || '/' || :'client_object' || '.jpg'
  ),
  'the live crew lead can upload a visit photo'
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'visit-photos'
      and name = :'org' || '/' || :'visit_a' || '/' || :'client_object' || '.jpg'
  ),
  1::bigint,
  'the live crew lead can read the uploaded photo'
);

select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'visit-photos'
      and name = :'org' || '/' || :'visit_a' || '/' || :'client_object' || '.jpg'
  ),
  1::bigint,
  'a crew member can read the crew photo'
);
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('visit-photos', %L) $$,
    :'org' || '/' || :'visit_a' || '/' || :'client_object_2' || '.jpg'
  ),
  '42501',
  null,
  'a crew member who is not the lead cannot upload'
);

select tests.authenticate_as(:'south'::uuid, :'org'::uuid, 'crew');
select is(
  (select count(*) from storage.objects where bucket_id = 'visit-photos'),
  0::bigint,
  'another crew cannot read the photo object'
);

select tests.authenticate_anon();
select is(
  (select count(*) from storage.objects where bucket_id = 'visit-photos'),
  0::bigint,
  'anon cannot read visit photo objects'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select count(*) from storage.objects where bucket_id = 'visit-photos'),
  1::bigint,
  'the office can read visit photo objects'
);
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('visit-photos', %L) $$,
    :'org' || '/' || :'visit_a' || '/' || :'client_before' || '.jpg'
  ),
  '42501',
  null,
  'the office cannot upload through the crew photo policy'
);

select tests.authenticate_as(:'other'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from storage.objects where bucket_id = 'visit-photos'),
  0::bigint,
  'another org cannot read visit photo objects'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('visit-photos', 'nope.jpg') $$,
  '42501',
  null,
  'a photo path outside the visit key is denied'
);

select tests.clear_auth();
update public.memberships
set role = 'crew'
where org_id = :'org'::uuid
  and user_id = :'lead'::uuid;

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  private.is_live_crew_lead(:'org'::uuid, :'crew_north'::uuid),
  false,
  'a demoted lead fails the live role check'
);
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('visit-photos', %L) $$,
    :'org' || '/' || :'visit_d' || '/' || :'client_issue' || '.jpg'
  ),
  '42501',
  null,
  'a demoted lead cannot upload'
);

select * from finish();
