-- Chemical, snow, and irrigation logs ride the crew outbox.
-- Existing visit_start still applies. A replay does not insert twice.

select plan(21);

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

select ok(
  not has_function_privilege(
    'authenticated',
    'private.crew_apply_field_log(text,uuid,uuid,timestamptz,timestamptz,jsonb)',
    'execute'
  ),
  'field logs are applied only through crew_apply'
);

select tests.create_user('flog-owner@example.com', 'Flog Owner') as owner \gset
select tests.create_user('flog-owner2@example.com', 'Flog Owner Two') as owner2 \gset
select tests.create_user('flog-lead@example.com', 'Flog Lead') as lead \gset
select tests.create_user('flog-hand@example.com', 'Flog Hand') as hand \gset

select tests.create_org('Flog', 'flog', :'owner'::uuid) as org \gset
select tests.create_org('Flog Two', 'flogtwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'hand'::uuid, 'crew');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date + 10) as later \gset

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Flog Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '4 Outbox Ln', 'Nashville', 'TN', '37201')
returning id as prop \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Treat') returning id as job \gset
insert into public.crews (org_id, name) values (:'org'::uuid, 'Flog Crew') returning id as crew \gset
insert into public.crew_members (org_id, crew_id, profile_id) values
  (:'org'::uuid, :'crew'::uuid, :'lead'::uuid),
  (:'org'::uuid, :'crew'::uuid, :'hand'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew'::uuid;

insert into public.routes (org_id, crew_id, date, status, published_at)
values (:'org'::uuid, :'crew'::uuid, :'today'::date, 'published', now())
returning id as route \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job'::uuid, :'prop'::uuid, :'route'::uuid, 0, :'today'::date, :'today'::date, 'scheduled'
) returning id as visit \gset

insert into public.routes (org_id, crew_id, date, status, published_at)
values (:'org'::uuid, :'crew'::uuid, :'later'::date, 'published', now())
returning id as later_route \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'job'::uuid, :'prop'::uuid, :'later_route'::uuid, 0, :'later'::date, :'later'::date, 'scheduled'
) returning id as later_visit \gset

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');

select is(
  tests.apply_crew(
    'visit_start', :'visit'::uuid, '88888888-8888-4888-8888-888888888888'::uuid,
    now(), now(), '{}'::jsonb
  ),
  'applied',
  'starting a visit still applies'
);
select is(
  (select status::text from public.visits where id = :'visit'::uuid),
  'in_progress',
  'the visit is in progress after start'
);

select is(
  tests.apply_crew(
    'visit_log_chemical', :'visit'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
    now(), now(),
    '{"product":" Trimec ","rate":"1.5 oz / 1000 sq ft","epa_reg_no":"2217-543","temp_f":72,"wind_mph":4,"conditions":"Clear"}'::jsonb
  ),
  'applied',
  'the lead logs a chemical application from the outbox'
);
select is(
  (select product || ' ' || rate || ' ' || epa_reg_no || ' ' || temp_f::text || ' ' || wind_mph::text || ' ' || conditions
     from public.chemical_applications where visit_id = :'visit'::uuid),
  'Trimec 1.5 oz / 1000 sq ft 2217-543 72 4 Clear',
  'the chemical log keeps product, rate, EPA number, and weather'
);
select is(
  (select recorded_by from public.chemical_applications where visit_id = :'visit'::uuid),
  :'lead'::uuid,
  'the chemical log records the lead'
);
select is(
  tests.apply_crew(
    'visit_log_chemical', :'visit'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
    now(), now(),
    '{"product":"Other","rate":"9","epa_reg_no":"1","temp_f":70,"wind_mph":1}'::jsonb
  ),
  'replayed',
  'the same chemical client id does not write again'
);
select is(
  (select count(*) from public.chemical_applications where visit_id = :'visit'::uuid),
  1::bigint,
  'one chemical log remains after replay'
);

select is(
  tests.apply_crew(
    'visit_log_snow', :'visit'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
    now(), now(),
    '{"trigger_depth_in":2,"started_at":"2026-01-15T06:00:00Z","ended_at":"2026-01-15T09:30:00Z","materials":" salt, 2 bags "}'::jsonb
  ),
  'applied',
  'the lead logs a snow event from the outbox'
);
select is(
  (select materials || ' ' || trigger_depth_in::text from public.snow_event_logs where visit_id = :'visit'::uuid),
  'salt, 2 bags 2',
  'the snow log keeps materials and trigger depth'
);
select throws_ok(
  format(
    $$ select tests.apply_crew(
         'visit_log_snow', %L::uuid, '33333333-3333-4333-8333-333333333333'::uuid,
         now(), now(),
         '{"trigger_depth_in":2,"started_at":"2026-01-15T09:00:00Z","ended_at":"2026-01-15T06:00:00Z","materials":"salt"}'::jsonb
       ) $$,
    :'visit'
  ),
  '22023',
  'The snow event has to end after it starts',
  'a snow event that ends first is refused'
);

select is(
  tests.apply_crew(
    'visit_log_irrigation', :'visit'::uuid, '44444444-4444-4444-8444-444444444444'::uuid,
    now(), now(),
    '{"zone_number":3,"note":" head leaking at the curb "}'::jsonb
  ),
  'applied',
  'the lead logs an irrigation zone note from the outbox'
);
select is(
  (select zone_number::text || ' ' || note from public.irrigation_zone_notes where visit_id = :'visit'::uuid),
  '3 head leaking at the curb',
  'the zone note keeps the zone and the note'
);

select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ select tests.apply_crew(
         'visit_log_chemical', %L::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
         now(), now(),
         '{"product":"Trimec","rate":"1","epa_reg_no":"2217-543","temp_f":70,"wind_mph":1}'::jsonb
       ) $$,
    :'visit'
  ),
  '42501',
  'not allowed',
  'a hand on the crew cannot log the stop'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format(
    $$ select tests.apply_crew(
         'visit_log_chemical', %L::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid,
         now(), now(),
         '{"product":" ","rate":"1","epa_reg_no":"2217-543","temp_f":70,"wind_mph":1}'::jsonb
       ) $$,
    :'visit'
  ),
  '22023',
  'Product, rate, and EPA registration number are required',
  'a chemical log needs a product, rate, and EPA number'
);
select throws_ok(
  format(
    $$ select tests.apply_crew(
         'visit_log_snow', %L::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
         now(), now(),
         '{"trigger_depth_in":2,"started_at":"2026-01-15T06:00:00Z","ended_at":"2026-01-15T09:30:00Z","materials":"salt"}'::jsonb
       ) $$,
    :'visit'
  ),
  '22023',
  'client_id was already used',
  'a client id cannot be reused for a different log'
);
select throws_ok(
  format(
    $$ select tests.apply_crew(
         'visit_log_chemical', %L::uuid, '55555555-5555-4555-8555-555555555555'::uuid,
         now(), now(),
         '{"product":"Trimec","rate":"1","epa_reg_no":"2217-543","temp_f":70,"wind_mph":1}'::jsonb
       ) $$,
    :'later_visit'
  ),
  '22023',
  'that visit is not on today''s route',
  'a stop outside the crew window is not logged'
);
select throws_ok(
  format(
    $$ select tests.apply_crew(
         'visit_log_chemical', %L::uuid, '77777777-7777-4777-8777-777777777777'::uuid,
         now(), now(),
         '{"product":"Trimec","rate":"1","epa_reg_no":"2217-543","temp_f":70,"wind_mph":1,"price":12}'::jsonb
       ) $$,
    :'visit'
  ),
  '22023',
  'crew payloads cannot include money',
  'a field log cannot carry a price'
);

select is(
  (
    public.crew_sync(jsonb_build_array(jsonb_build_object(
      'client_id', '66666666-6666-4666-8666-666666666666',
      'kind', 'visit_log_irrigation',
      'visit_id', :'visit',
      'occurred_at', now(),
      'device_now', now(),
      'payload', jsonb_build_object('zone_number', 4, 'note', 'Zone 4 is dry')
    ))) -> 'results' -> 0 ->> 'status'
  ),
  'applied',
  'crew_sync writes an irrigation zone note'
);
select is(
  (select note from public.irrigation_zone_notes where visit_id = :'visit'::uuid and zone_number = 4),
  'Zone 4 is dry',
  'the synced zone note is stored'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select throws_ok(
  format(
    $$ select tests.apply_crew(
         'visit_log_chemical', %L::uuid, '99999999-9999-4999-8999-999999999999'::uuid,
         now(), now(),
         '{"product":"Trimec","rate":"1","epa_reg_no":"2217-543","temp_f":70,"wind_mph":1}'::jsonb
       ) $$,
    :'visit'
  ),
  'P0002',
  'visit not found',
  'another company cannot log this stop'
);
select tests.clear_auth();

select * from finish();
