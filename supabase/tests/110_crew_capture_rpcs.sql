-- Crew day pack, crew_sync, and the visit mutations. Prices, customer
-- phone, and customer email stay out of the pack. Replays do not duplicate.

select plan(102);

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

select has_table('public', 'crew_mutation_receipts', 'crew mutation receipts exist');
select has_column('public', 'visits', 'crew_note', 'visits.crew_note exists');
select ok(
  not has_column_privilege('authenticated', 'public.visits', 'crew_note', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.crew_mutation_receipts', 'SELECT'),
  'crew notes and receipts are not written or read directly'
);
select ok(
  (
    select bool_and(
      not has_function_privilege('anon', fn, 'execute')
      and has_function_privilege('authenticated', fn, 'execute')
      and has_function_privilege('service_role', fn, 'execute')
    )
    from (
      values
        ('public.crew_day_pack(date)'),
        ('public.crew_ack_day_pack(date,uuid)'),
        ('public.crew_sync(jsonb)')
    ) as fns(fn)
  ),
  'crew RPCs are granted to authenticated and service_role'
);
select has_table('public', 'crew_phone_sync', 'crew_phone_sync exists');
select ok(
  has_table_privilege('authenticated', 'public.crew_phone_sync', 'SELECT')
  and not has_table_privilege('authenticated', 'public.crew_phone_sync', 'INSERT')
  and not has_table_privilege('authenticated', 'public.crew_phone_sync', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.crew_phone_sync', 'DELETE'),
  'crew_phone_sync is office-readable and not directly writable'
);
select ok(
  not has_function_privilege('anon', 'private.crew_apply(text,uuid,uuid,timestamptz,timestamptz,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'private.crew_apply(text,uuid,uuid,timestamptz,timestamptz,jsonb)', 'execute')
    and has_function_privilege('service_role', 'private.crew_apply(text,uuid,uuid,timestamptz,timestamptz,jsonb)', 'execute'),
  'private.crew_apply is not granted to authenticated'
);
select ok(
  to_regprocedure('public.visit_start(uuid,uuid,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_pause(uuid,uuid,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_resume(uuid,uuid,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_finish(uuid,uuid,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_skip(uuid,uuid,text,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_reopen(uuid,uuid,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_set_crew_size(uuid,uuid,integer,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_set_note(uuid,uuid,text,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_task_set(uuid,uuid,uuid,boolean,text,timestamptz,timestamptz)') is null
    and to_regprocedure('public.visit_photo_record(uuid,uuid,text,timestamptz,double precision,double precision,timestamptz)') is null
    and to_regprocedure('public.enhancement_create(uuid,uuid,text,text,uuid[],timestamptz,timestamptz)') is null,
  'visit mutations are not separate RPCs'
);

select tests.create_user('rpcb-owner@example.com', 'RPCB Owner') as owner \gset
select tests.create_user('rpcb-dispatch@example.com', 'RPCB Dispatch') as dispatcher \gset
select tests.create_user('rpcb-lead@example.com', 'RPCB Lead') as lead \gset
select tests.create_user('rpcb-hand@example.com', 'RPCB Hand') as hand \gset
select tests.create_user('rpcb-south@example.com', 'RPCB South') as south \gset

select tests.create_org('RPCB', 'rpcb', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'hand'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'south'::uuid, 'crew_lead');
update public.orgs set phone = '217-555-0140' where id = :'org'::uuid;

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date - 1) as yesterday \gset
select (:'today'::date - 2) as older \gset
select (:'today'::date - 3) as ancient \gset
select (:'today'::date + 1) as tomorrow \gset

insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (
  :'org'::uuid, 'Quinlan Hollis', '555-0199', 'crew-secret@example.com',
  'bills-secret@example.com', '9 Billing Secret Ln'
) returning id as acct \gset

insert into public.contacts (org_id, account_id, first_name, last_name, email, phone, is_primary)
values (
  :'org'::uuid, :'acct'::uuid, 'Quinlan', 'Hollis',
  'crew-secret@example.com', '555-0188', true
);

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code, crew_notes, has_dogs, location
) values (
  :'org'::uuid, :'acct'::uuid, '1503 Larkspur', 'Springfield', 'IL', '62704',
  'side gate', true, extensions.st_geogfromtext('SRID=4326;POINT(-89.65 39.78)')
) returning id as prop \gset

insert into public.property_access (property_id, org_id, gate_code, access_notes)
values (:'prop'::uuid, :'org'::uuid, '4815', 'dog in the back');

insert into public.quotes (org_id, account_id, property_id, number, title)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 1, 'Weekly')
returning id as quote \gset
insert into public.quote_versions (org_id, quote_id, version)
values (:'org'::uuid, :'quote'::uuid, 1)
returning id as version \gset
insert into public.quote_line_items (org_id, version_id, name, price, cost, notes_crew)
values (:'org'::uuid, :'version'::uuid, 'Secret mow', 87.65, 87.65, 'priced note')
returning id as line \gset

insert into public.measurements (org_id, property_id, status)
values (:'org'::uuid, :'prop'::uuid, 'current')
returning id as measurement \gset
insert into public.measurement_features (org_id, measurement_id, category, geom, label)
values (
  :'org'::uuid, :'measurement'::uuid, 'turf_front',
  extensions.st_geogfromtext('SRID=4326;POLYGON((-89.651 39.781, -89.649 39.781, -89.649 39.782, -89.651 39.782, -89.651 39.781))'),
  'front lawn'
);

insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Mow') returning id as job_a \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Skip weather') returning id as job_b \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Skip gate') returning id as job_c \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Cancelled') returning id as job_x \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Older') returning id as job_old \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Yesterday') returning id as job_y \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Second') returning id as job_d \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'South') returning id as job_s \gset

insert into public.crews (org_id, name) values (:'org'::uuid, 'North') returning id as crew_north \gset
insert into public.crews (org_id, name) values (:'org'::uuid, 'South') returning id as crew_south \gset
insert into public.crew_members (org_id, crew_id, profile_id) values
  (:'org'::uuid, :'crew_north'::uuid, :'lead'::uuid),
  (:'org'::uuid, :'crew_north'::uuid, :'hand'::uuid),
  (:'org'::uuid, :'crew_south'::uuid, :'south'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew_north'::uuid;
update public.crews set default_lead_id = :'south'::uuid where id = :'crew_south'::uuid;

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_north'::uuid, :'today'::date, 'published')
returning id as route_today \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_north'::uuid, :'tomorrow'::date, 'draft')
returning id as route_draft \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_north'::uuid, :'yesterday'::date, 'published')
returning id as route_yesterday \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_north'::uuid, :'older'::date, 'published')
returning id as route_old \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_south'::uuid, :'today'::date, 'published')
returning id as route_south \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, budget_minutes, sort
) values (
  :'org'::uuid, :'job_a'::uuid, :'prop'::uuid, :'route_today'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 35, 1
) returning id as visit_a \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort
) values (
  :'org'::uuid, :'job_b'::uuid, :'prop'::uuid, :'route_today'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 2
) returning id as visit_b \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort
) values (
  :'org'::uuid, :'job_c'::uuid, :'prop'::uuid, :'route_today'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 3
) returning id as visit_c \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort
) values (
  :'org'::uuid, :'job_x'::uuid, :'prop'::uuid, :'route_today'::uuid,
  :'today'::date, :'today'::date, 'cancelled', 4
) returning id as visit_x \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort
) values (
  :'org'::uuid, :'job_d'::uuid, :'prop'::uuid, :'route_today'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 5
) returning id as visit_d \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_y'::uuid, :'prop'::uuid, :'route_yesterday'::uuid,
  :'yesterday'::date, :'yesterday'::date, 'scheduled'
) returning id as visit_y \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_old'::uuid, :'prop'::uuid, :'route_old'::uuid,
  :'older'::date, :'older'::date, 'scheduled'
) returning id as visit_old \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_a'::uuid, :'prop'::uuid, :'route_draft'::uuid,
  :'tomorrow'::date, :'tomorrow'::date, 'scheduled'
) returning id as visit_draft \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job_s'::uuid, :'prop'::uuid, :'route_south'::uuid,
  :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_s \gset

insert into public.visit_tasks (
  org_id, visit_id, label, quantity_text, notes_crew, source_line_item_id, sort
) values (
  :'org'::uuid, :'visit_a'::uuid, 'Mow', '6,840 sq ft', 'edge the walk', :'line'::uuid, 0
) returning id as task_a \gset

update public.visits set status = 'in_progress' where id = :'visit_old'::uuid;

select gen_random_uuid() as client_start \gset
select gen_random_uuid() as client_pause \gset
select gen_random_uuid() as client_resume \gset
select gen_random_uuid() as client_note \gset
select gen_random_uuid() as client_bad \gset
select gen_random_uuid() as client_skew \gset
select gen_random_uuid() as client_photo \gset
select gen_random_uuid() as client_finish \gset
select gen_random_uuid() as client_reopen \gset
select gen_random_uuid() as client_finish2 \gset
select gen_random_uuid() as client_reopen2 \gset
select gen_random_uuid() as client_size \gset
select gen_random_uuid() as client_task \gset
select gen_random_uuid() as client_enh \gset
select gen_random_uuid() as client_skip_b \gset
select gen_random_uuid() as client_skip_c \gset
select gen_random_uuid() as client_issue \gset
select gen_random_uuid() as client_old_pause \gset
select gen_random_uuid() as client_old_photo \gset
select gen_random_uuid() as client_old_finish \gset
select gen_random_uuid() as client_y \gset
select gen_random_uuid() as client_d \gset
select gen_random_uuid() as client_future \gset
select gen_random_uuid() as client_future_resume \gset
select gen_random_uuid() as client_blocked \gset
select (now() - interval '2 hours') as occurred \gset
select (now() - interval '10 minutes') as device_now \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'today'),
  '42501',
  null,
  'a dispatcher cannot download the crew pack'
);

select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select lives_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'today'),
  'a crew member can download the pack'
);
select is(
  (public.crew_day_pack(:'today'::date)->>'is_live_lead')::boolean,
  false,
  'a crew member is not the live lead'
);
select throws_ok(
  format($$ select tests.apply_crew('visit_start', %L, %L, null, null, '{}') $$, :'visit_a', :'client_start'),
  '42501',
  null,
  'a crew member cannot start a visit'
);

select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format($$ select tests.apply_crew('visit_start', %L, %L, null, null, '{}') $$, :'visit_a', :'client_start'),
  '42501',
  null,
  'a spoofed crew_lead token cannot start a visit'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'ancient'),
  '22023',
  null,
  'the day pack rejects a date outside the window'
);
select lives_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'older'),
  'an older date stays readable while a visit is in progress'
);
select lives_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'tomorrow'),
  'a draft route date is still inside the window'
);

select public.crew_day_pack(:'today'::date) as pack \gset
select is(
  ((:'pack')::jsonb->'route'->>'revision')::int,
  (select revision from public.routes where id = :'route_today'::uuid),
  'the day pack carries the route revision as version'
);
select is(
  ((:'pack')::jsonb->>'version')::int,
  (select revision from public.routes where id = :'route_today'::uuid),
  'the day pack exposes revision as top-level version'
);
select ok(
  (:'pack')::jsonb ? 'server_today',
  'the day pack includes server_today from the org clock'
);
select is(((:'pack')::jsonb->>'is_live_lead')::boolean, true, 'the day pack marks the live lead');
select ok(
  position('555-0199' in :'pack') = 0
  and position('555-0188' in :'pack') = 0
  and position('crew-secret@example.com' in :'pack') = 0
  and position('bills-secret@example.com' in :'pack') = 0
  and position('9 Billing Secret Ln' in :'pack') = 0
  and position('87.65' in :'pack') = 0
  and position('Quinlan' in :'pack') = 0
  and position(:'line' in :'pack') = 0,
  'the day pack has no customer phone, email, billing, or price'
);
select ok(position('217-555-0140' in :'pack') > 0, 'the day pack includes the office phone');
select ok(position('Hollis' in :'pack') > 0, 'the day pack includes the customer last name');
select ok(position('4815' in :'pack') > 0, 'the day pack includes the gate code for a live stop');
select ok(position('edge the walk' in :'pack') > 0, 'the day pack includes the crew task note');
select ok(position('1503 Larkspur' in :'pack') > 0, 'the day pack includes the address');
select ok(position('front lawn' in :'pack') > 0, 'the day pack includes the simplified plan');
select ok(
  (
    select (v->'property'->>'gate_code') is null
    from jsonb_array_elements((:'pack')::jsonb->'visits') v
    where v->>'id' = :'visit_x'
  ),
  'a cancelled stop omits the gate code'
);
select ok(
  (
    select (v->'property'->>'access_notes') is null
    from jsonb_array_elements((:'pack')::jsonb->'visits') v
    where v->>'id' = :'visit_x'
  ),
  'a cancelled stop omits the access notes'
);
select is(
  (
    select count(*)
    from jsonb_array_elements((:'pack')::jsonb->'visits') v
    where v->>'id' = :'visit_s'
  ),
  0::bigint,
  'the pack does not include another crew'
);
select is(
  (
    select count(*)
    from jsonb_array_elements(public.crew_day_pack(:'tomorrow'::date)->'visits') v
  ),
  0::bigint,
  'a draft route is not in the pack'
);
select is(
  (
    select count(*)
    from jsonb_array_elements((:'pack')::jsonb->'visits') v
    where v->>'id' = :'visit_old'
  ),
  1::bigint,
  'today includes an active visit older than yesterday'
);

select tests.clear_auth();
update public.routes set status = 'published' where id = :'route_draft'::uuid;
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format(
    $$ select tests.apply_crew('visit_start', %L, gen_random_uuid(), null, null, '{}') $$,
    :'visit_draft'
  ),
  '22023',
  null,
  'a visit scheduled for tomorrow cannot be started'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format($$ select tests.apply_crew('visit_start', %L, %L, null, null, '{}') $$, :'visit_a', :'client_d'),
  '42501',
  null,
  'a dispatcher cannot start a visit'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew');
select is(
  tests.apply_crew('visit_start', :'visit_a'::uuid, :'client_start'::uuid, null, null, '{}'::jsonb),
  'applied',
  'the live lead can start a visit when the token says crew'
);
select is(
  tests.apply_crew('visit_start', :'visit_a'::uuid, :'client_start'::uuid, null, null, '{}'::jsonb),
  'replayed',
  'starting again with the same client_id is a replay'
);
select is(
  (select count(*) from public.visit_events where visit_id = :'visit_a'::uuid and kind = 'started'),
  1::bigint,
  'a replay does not append a second start'
);
select throws_ok(
  format($$ select tests.apply_crew('visit_pause', %L, %L, null, null, '{}') $$, :'visit_a', :'client_start'),
  '22023',
  null,
  'a client_id cannot be reused for a different mutation'
);
select throws_ok(
  format(
    $$ select tests.apply_crew('visit_start', %L, %L, null, null, '{}') $$,
    :'visit_b', :'client_start'
  ),
  '22023',
  null,
  'a client_id cannot be reused on a different visit'
);
select is(
  tests.apply_crew('visit_start', :'visit_y'::uuid, :'client_y'::uuid, null, null, '{}'::jsonb),
  'applied',
  'a visit left in progress today does not block yesterday'
);
select throws_ok(
  format($$ select tests.apply_crew('visit_start', %L, %L, null, null, '{}') $$, :'visit_d', :'client_d'),
  '23514',
  null,
  'a second start today is rejected'
);
select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', :'client_blocked', 'kind', 'visit_start', 'visit_id', :'visit_d'
))) as sync_blocked \gset
select is((:'sync_blocked')::jsonb->'results'->0->>'status', 'error', 'a blocked start comes back as an error');
select is(
  (:'sync_blocked')::jsonb->'results'->0->>'message',
  'could not apply that change',
  'crew_sync does not return the raw SQL error'
);

select is(
  tests.apply_crew('visit_pause', :'visit_old'::uuid, :'client_old_pause'::uuid, null, null, '{}'::jsonb),
  'applied',
  'a visit left in progress on a past day can be paused'
);
select tests.clear_auth();
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_old' || '/' || :'client_old_photo' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_old'::uuid, :'client_old_photo'::uuid, null, null,
    jsonb_build_object('photo_kind', 'after')
  ),
  'applied',
  'a past-day visit can record the after photo it needs'
);
select is(
  tests.apply_crew('visit_finish', :'visit_old'::uuid, :'client_old_finish'::uuid, null, null, '{}'::jsonb),
  'applied',
  'a visit left in progress on a past day can be finished'
);
select tests.clear_auth();
select is(
  (select status::text from public.visits where id = :'visit_old'::uuid),
  'completed',
  'the past-day visit is completed'
);
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  (
    select count(*)
    from jsonb_array_elements(public.crew_day_pack(:'today'::date)->'visits') v
    where v->>'id' = :'visit_old'
  ),
  0::bigint,
  'a finished older visit drops out of today'
);
select throws_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'older'),
  '22023',
  null,
  'an older date is outside the window once that visit is finished'
);

select public.crew_sync(jsonb_build_array(
  jsonb_build_object(
    'client_id', :'client_pause', 'kind', 'visit_pause', 'visit_id', :'visit_a'
  ),
  jsonb_build_object(
    'client_id', :'client_resume', 'kind', 'visit_resume', 'visit_id', :'visit_a'
  )
)) as sync1 \gset
select is((:'sync1')::jsonb->'results'->0->>'status', 'applied', 'crew_sync applies the first mutation');
select is((:'sync1')::jsonb->'results'->1->>'status', 'applied', 'crew_sync applies the second mutation');
select public.crew_sync(jsonb_build_array(
  jsonb_build_object(
    'client_id', :'client_pause', 'kind', 'visit_pause', 'visit_id', :'visit_a'
  ),
  jsonb_build_object(
    'client_id', :'client_resume', 'kind', 'visit_resume', 'visit_id', :'visit_a'
  )
)) as sync2 \gset
select is((:'sync2')::jsonb->'results'->0->>'status', 'replayed', 'replaying the batch replays the pause');
select is((:'sync2')::jsonb->'results'->1->>'status', 'replayed', 'replaying the batch replays the resume');
select is(
  (select count(*) from public.visit_events where visit_id = :'visit_a'::uuid and kind = 'paused'),
  1::bigint,
  'replaying the batch does not duplicate the pause'
);

select public.crew_sync(jsonb_build_array(
  jsonb_build_object(
    'client_id', :'client_note', 'kind', 'visit_set_note', 'visit_id', :'visit_a',
    'payload', jsonb_build_object('note', 'left the side gate')
  ),
  jsonb_build_object(
    'client_id', :'client_bad', 'kind', 'visit_start', 'visit_id', :'visit_a'
  ),
  jsonb_build_object(
    'client_id', :'client_size', 'kind', 'visit_set_crew_size', 'visit_id', :'visit_a',
    'payload', jsonb_build_object('crew_size', 4)
  )
)) as sync3 \gset
select is((:'sync3')::jsonb->'results'->0->>'status', 'applied', 'crew_sync keeps the mutation before the error');
select is((:'sync3')::jsonb->'results'->1->>'status', 'error', 'crew_sync stops on the first error');
select is(jsonb_array_length((:'sync3')::jsonb->'results'), 2, 'crew_sync does not continue after the error');
select is(
  (select crew_note from public.visits where id = :'visit_a'::uuid),
  'left the side gate',
  'the note before the error was saved'
);
select is(
  (select crew_size from public.visits where id = :'visit_a'::uuid),
  1,
  'the mutation after the error was not applied'
);

select is(
  tests.apply_crew(
    'visit_pause', :'visit_a'::uuid, :'client_skew'::uuid, :'occurred'::timestamptz, :'device_now'::timestamptz, '{}'::jsonb
  ),
  'applied',
  'a pause with a skewed device clock is accepted'
);
select ok(
  (
    select occurred_at = :'occurred'::timestamptz and device_clock_skewed
    from public.visit_events
    where client_id = :'client_skew'::uuid
  ),
  'the captured time is kept and the clock is flagged'
);
select is(
  tests.apply_crew('visit_resume', :'visit_a'::uuid, gen_random_uuid(), null, null, '{}'::jsonb),
  'applied',
  'the lead can resume'
);
select is(
  tests.apply_crew(
    'visit_pause', :'visit_a'::uuid, :'client_future'::uuid, now() + interval '3 days', null, '{}'::jsonb
  ),
  'applied',
  'a pause is accepted when the phone clock is ahead'
);
select ok(
  (
    select occurred_at <= pg_catalog.now()
    from public.visit_events
    where client_id = :'client_future'::uuid
  ),
  'a future client timestamp is clamped to server time'
);
select tests.apply_crew(
  'visit_resume', :'visit_a'::uuid, :'client_future_resume'::uuid, null, null, '{}'::jsonb
) as future_resume \gset

select throws_ok(
  format($$ select tests.apply_crew('visit_finish', %L, %L, null, null, '{}') $$, :'visit_a', :'client_finish'),
  '22023',
  null,
  'finishing requires the after photo file'
);
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_a' || '/' || :'client_photo' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_a'::uuid, :'client_photo'::uuid, now(), null,
    jsonb_build_object('photo_kind', 'after', 'taken_at', now(), 'lat', 39.78, 'lng', -89.65)
  ),
  'applied',
  'the lead can record an after photo'
);
select is(
  tests.apply_crew('visit_finish', :'visit_a'::uuid, :'client_finish'::uuid, null, null, '{}'::jsonb),
  'applied',
  'the lead can finish after the photo is stored'
);
select is(
  (select reopen_until from public.visits where id = :'visit_a'::uuid),
  (
    select ((private.org_local_today(:'org'::uuid)::text || ' 18:00:00')::timestamp at time zone o.timezone)
    from public.orgs o
    where o.id = :'org'::uuid
  ),
  'finish can be reopened until 6 PM org local time'
);

select tests.clear_auth();
update public.visits
set reopen_until = now() + interval '1 hour'
where id = :'visit_a'::uuid;
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew('visit_reopen', :'visit_a'::uuid, :'client_reopen'::uuid, null, null, '{}'::jsonb),
  'applied',
  'the lead can reopen before the deadline'
);
select is(
  tests.apply_crew('visit_finish', :'visit_a'::uuid, :'client_finish2'::uuid, null, null, '{}'::jsonb),
  'applied',
  'the lead can finish again after reopening'
);
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format($$ select public.cancel_visit(%L, 'customer called') $$, :'visit_a'),
  'the office can flag a completion'
);
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format($$ select tests.apply_crew('visit_reopen', %L, %L, null, null, '{}') $$, :'visit_a', :'client_reopen2'),
  '22023',
  null,
  'a completion the office cancelled cannot be reopened'
);

select is(
  tests.apply_crew(
    'visit_set_crew_size', :'visit_b'::uuid, :'client_size'::uuid, null, null,
    jsonb_build_object('crew_size', 3)
  ),
  'applied',
  'the lead can set the crew size'
);
select is(
  tests.apply_crew(
    'visit_task_set', :'visit_a'::uuid, :'client_task'::uuid, null, null,
    jsonb_build_object('task_id', :'task_a'::uuid, 'done', true)
  ),
  'applied',
  'the lead can tick a task'
);
select throws_ok(
  format(
    $$ select tests.apply_crew('enhancement_create', %L, %L, null, null, jsonb_build_object('tag', 'mulch', 'note', 'beds are thin', 'photo_ids', jsonb_build_array(%L::uuid))) $$,
    :'visit_a', :'client_enh', :'client_photo'
  ),
  '22023',
  null,
  'an enhancement photo must be a photo row'
);
select id as photo_a
from public.visit_photos
where client_id = :'client_photo'::uuid \gset
select is(
  tests.apply_crew(
    'enhancement_create', :'visit_a'::uuid, :'client_enh'::uuid, null, null,
    jsonb_build_object(
      'tag', 'mulch',
      'note', 'beds are thin',
      'photo_ids', jsonb_build_array(:'photo_a'::uuid)
    )
  ),
  'applied',
  'the lead can file an enhancement from a photo on the visit'
);

select is(
  tests.apply_crew(
    'visit_skip', :'visit_b'::uuid, :'client_skip_b'::uuid, null, null,
    jsonb_build_object('reason', 'weather')
  ),
  'applied',
  'a weather skip does not need a photo'
);
select throws_ok(
  format(
    $$ select tests.apply_crew('visit_skip', %L, %L, null, null, jsonb_build_object('reason', 'gate_locked')) $$,
    :'visit_c', :'client_skip_c'
  ),
  '22023',
  null,
  'a gate locked skip needs an issue photo'
);
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_c' || '/' || :'client_issue' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_c'::uuid, :'client_issue'::uuid, null, null,
    jsonb_build_object('photo_kind', 'issue')
  ),
  'applied',
  'the lead can record an issue photo'
);
select is(
  tests.apply_crew(
    'visit_skip', :'visit_c'::uuid, :'client_skip_c'::uuid, null, null,
    jsonb_build_object('reason', 'gate_locked')
  ),
  'applied',
  'a gate locked skip is accepted with an issue photo'
);

select gen_random_uuid() as client_missing_photo \gset
select gen_random_uuid() as client_batch_photo \gset
select gen_random_uuid() as client_batch_enh \gset
select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', :'client_missing_photo',
  'kind', 'visit_photo_record',
  'visit_id', :'visit_b',
  'payload', jsonb_build_object('photo_kind', 'before')
))) as sync_missing \gset
select is(
  (:'sync_missing')::jsonb->'results'->0->>'message',
  'visit photo file is missing',
  'a photo row without its file names that error'
);
select tests.clear_auth();
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_b' || '/' || :'client_batch_photo' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select public.crew_sync(jsonb_build_array(
  jsonb_build_object(
    'client_id', :'client_batch_photo',
    'kind', 'visit_photo_record',
    'visit_id', :'visit_b',
    'payload', jsonb_build_object('photo_kind', 'upsell')
  ),
  jsonb_build_object(
    'client_id', :'client_batch_enh',
    'kind', 'enhancement_create',
    'visit_id', :'visit_b',
    'payload', jsonb_build_object('tag', 'mulch', 'photo_client_id', :'client_batch_photo')
  )
)) as sync_batch \gset
select is((:'sync_batch')::jsonb->'results'->0->>'status', 'applied', 'the upsell photo row is applied');
select is((:'sync_batch')::jsonb->'results'->1->>'status', 'applied', 'the upsell matches its photo in the same batch');
select is(
  (public.crew_day_pack(:'today'::date)->'crew'->>'id')::uuid,
  :'crew_north'::uuid,
  'the day pack uses this caller crew'
);

select gen_random_uuid() as client_early_photo \gset
select gen_random_uuid() as client_early_enh \gset
select gen_random_uuid() as client_y_after \gset
select gen_random_uuid() as client_missing_id \gset
select gen_random_uuid() as client_miss_enh \gset
select gen_random_uuid() as client_miss_finish \gset
select tests.clear_auth();
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_b' || '/' || :'client_early_photo' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', :'client_early_photo',
  'kind', 'visit_photo_record',
  'visit_id', :'visit_b',
  'payload', jsonb_build_object('photo_kind', 'upsell')
))) as sync_early_photo \gset
select is((:'sync_early_photo')::jsonb->'results'->0->>'status', 'applied', 'an upsell photo can be saved before its request');
select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', :'client_early_enh',
  'kind', 'enhancement_create',
  'visit_id', :'visit_b',
  'payload', jsonb_build_object('tag', 'mulch', 'photo_client_id', :'client_early_photo')
))) as sync_early_enh \gset
select is((:'sync_early_enh')::jsonb->'results'->0->>'status', 'applied', 'an upsell matches a photo from an earlier sync');
select is(
  (select photo_ids[1] from public.enhancement_requests where client_id = :'client_early_enh'::uuid),
  (select id from public.visit_photos where client_id = :'client_early_photo'::uuid),
  'the earlier photo is stored on the upsell'
);
select tests.clear_auth();
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_y' || '/' || :'client_y_after' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_y'::uuid, :'client_y_after'::uuid, null, null,
    jsonb_build_object('photo_kind', 'after')
  ),
  'applied',
  'the in-progress visit has the after photo finish needs'
);
select public.crew_sync(jsonb_build_array(
  jsonb_build_object(
    'client_id', :'client_miss_enh',
    'kind', 'enhancement_create',
    'visit_id', :'visit_y',
    'payload', jsonb_build_object('tag', 'mulch', 'photo_client_id', :'client_missing_id')
  ),
  jsonb_build_object(
    'client_id', :'client_miss_finish',
    'kind', 'visit_finish',
    'visit_id', :'visit_y'
  )
)) as sync_miss \gset
select is((:'sync_miss')::jsonb->'results'->0->>'status', 'error', 'a missing upsell photo is not accepted');
select is(
  (:'sync_miss')::jsonb->'results'->0->>'message',
  'enhancement photo must belong to this visit',
  'a missing upsell photo is handed back for the office'
);
select is((:'sync_miss')::jsonb->'results'->1->>'status', 'applied', 'finish in the same batch still applies');
select is(
  (select status::text from public.visits where id = :'visit_y'::uuid),
  'completed',
  'the visit is finished even though the upsell photo was missing'
);
select is(
  (select count(*) from public.enhancement_requests where client_id = :'client_miss_enh'::uuid),
  0::bigint,
  'the unmatched upsell is not stored'
);

select tests.clear_auth();
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select public.crew_ack_day_pack(:'today'::date, :'crew_north'::uuid) as ack1 \gset
select is(
  ((:'ack1')::jsonb->>'version')::int,
  (select revision from public.routes where id = :'route_today'::uuid),
  'ack records the current pack version'
);
select tests.clear_auth();
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select is(
  (select pack_version from public.crew_phone_sync
    where org_id = :'org'::uuid and profile_id = :'lead'::uuid and route_date = :'today'::date),
  ((:'ack1')::jsonb->>'version')::int,
  'crew_phone_sync stores the acked version'
);
select public.reorder_route_visits(
  :'route_today'::uuid,
  array(select id from public.visits
    where route_id = :'route_today'::uuid and status = 'scheduled'
    order by sort desc)
);
select is(
  (select revision from public.routes where id = :'route_today'::uuid) >
    ((:'ack1')::jsonb->>'version')::int,
  true,
  'reordering a published route bumps the pack version'
);
select tests.clear_auth();
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select public.crew_ack_day_pack(:'today'::date, :'crew_north'::uuid) as ack2 \gset
select is(
  ((:'ack2')::jsonb->>'version')::int,
  (select revision from public.routes where id = :'route_today'::uuid),
  'ack after reorder advances the phone sync version'
);

-- Two-crew member: ack stores the crew passed from the pack, not membership order.
select tests.clear_auth();
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew_south'::uuid, :'hand'::uuid);
select tests.clear_auth();
select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select (public.crew_day_pack(:'today'::date)->'crew'->>'id')::uuid as pack_crew \gset
select case
  when :'pack_crew'::uuid = :'crew_north'::uuid then :'crew_south'::uuid
  else :'crew_north'::uuid
end as other_crew \gset
select ok(
  :'pack_crew'::uuid is distinct from :'other_crew'::uuid,
  'the two-crew hand has a membership-order pack crew and a different other crew'
);
select public.crew_ack_day_pack(:'today'::date, :'other_crew'::uuid) as ack_other \gset
select is(
  ((:'ack_other')::jsonb->>'crew_id')::uuid,
  :'other_crew'::uuid,
  'ack returns the crew from the downloaded route, not membership order'
);
select tests.clear_auth();
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select is(
  (select crew_id from public.crew_phone_sync
    where org_id = :'org'::uuid and profile_id = :'hand'::uuid and route_date = :'today'::date),
  :'other_crew'::uuid,
  'phone sync stores the acked crew for a two-crew member'
);

select tests.clear_auth();
update public.memberships
set role = 'crew'
where org_id = :'org'::uuid
  and user_id = :'lead'::uuid;
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format($$ select tests.apply_crew('visit_start', %L, %L, null, null, '{}') $$, :'visit_a', :'client_start'),
  '42501',
  null,
  'a demoted lead cannot replay a start'
);
select is(
  (select count(*) from public.visit_events where visit_id = :'visit_a'::uuid and kind = 'started'),
  1::bigint,
  'the refused replay does not add a start'
);
select throws_ok(
  format($$ select tests.apply_crew('visit_pause', %L, %L, null, null, '{}') $$, :'visit_d', gen_random_uuid()),
  '42501',
  null,
  'a demoted lead cannot pause'
);
select throws_ok(
  format($$ select tests.apply_crew('visit_finish', %L, %L, null, null, '{}') $$, :'visit_y', gen_random_uuid()),
  '42501',
  null,
  'a demoted lead cannot finish'
);

select * from finish();
