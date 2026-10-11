-- S13: mid-visit cancel, cross-crew done, past-midnight, forgot to finish (#93).

select plan(23);

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

select has_column('public', 'visits', 'forgot_to_finish', 'forgot_to_finish column exists');
select col_not_null('public', 'visits', 'forgot_to_finish', 'forgot_to_finish is required');

select tests.create_user('s13-owner@example.com', 'S13 Owner') as owner \gset
select tests.create_user('s13-dispatch@example.com', 'S13 Dispatch') as dispatcher \gset
select tests.create_user('s13-lead@example.com', 'S13 Lead') as lead \gset
select tests.create_user('s13-south@example.com', 'S13 South') as south \gset
select tests.create_org('S13 Co', 's13-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'south'::uuid, 'crew_lead');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date - 1) as yesterday \gset

insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (
  :'org'::uuid, 'S13 Account', '555-0130', 's13@example.com',
  's13-bill@example.com', '1 Bill St'
) returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code, location)
values (
  :'org'::uuid, :'acct'::uuid, '13 Edge Ln', 'Springfield', 'IL', '62704',
  extensions.st_geogfromtext('SRID=4326;POINT(-89.65 39.78)')
) returning id as prop \gset

insert into public.jobs (org_id, property_id, title) values
  (:'org'::uuid, :'prop'::uuid, 'Cancel finish') returning id as job_cancel \gset
insert into public.jobs (org_id, property_id, title) values
  (:'org'::uuid, :'prop'::uuid, 'Past midnight') returning id as job_midnight \gset
insert into public.jobs (org_id, property_id, title) values
  (:'org'::uuid, :'prop'::uuid, 'Twelve hour') returning id as job_twelve \gset
insert into public.jobs (org_id, property_id, title) values
  (:'org'::uuid, :'prop'::uuid, 'Cross crew') returning id as job_cross \gset
insert into public.jobs (org_id, property_id, title) values
  (:'org'::uuid, :'prop'::uuid, 'Stop cancel') returning id as job_stop \gset

insert into public.crews (org_id, name) values (:'org'::uuid, 'Crew A') returning id as crew_a \gset
insert into public.crews (org_id, name) values (:'org'::uuid, 'Crew B') returning id as crew_b \gset
insert into public.crew_members (org_id, crew_id, profile_id) values
  (:'org'::uuid, :'crew_a'::uuid, :'lead'::uuid),
  (:'org'::uuid, :'crew_b'::uuid, :'south'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew_a'::uuid;
update public.crews set default_lead_id = :'south'::uuid where id = :'crew_b'::uuid;

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_a'::uuid, :'today'::date, 'published')
returning id as route_a \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_a'::uuid, :'yesterday'::date, 'published')
returning id as route_y \gset
insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew_b'::uuid, :'today'::date, 'published')
returning id as route_b \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort, crew_size
) values (
  :'org'::uuid, :'job_cancel'::uuid, :'prop'::uuid, :'route_a'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 1, 2
) returning id as visit_cancel \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort, crew_size
) values (
  :'org'::uuid, :'job_midnight'::uuid, :'prop'::uuid, :'route_y'::uuid,
  :'yesterday'::date, :'yesterday'::date, 'scheduled', 1, 2
) returning id as visit_midnight \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort, crew_size
) values (
  :'org'::uuid, :'job_twelve'::uuid, :'prop'::uuid, :'route_a'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 2, 2
) returning id as visit_twelve \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort, crew_size
) values (
  :'org'::uuid, :'job_cross'::uuid, :'prop'::uuid, :'route_b'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 1, 2
) returning id as visit_cross \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort, crew_size
) values (
  :'org'::uuid, :'job_stop'::uuid, :'prop'::uuid, :'route_a'::uuid,
  :'today'::date, :'today'::date, 'scheduled', 3, 2
) returning id as visit_stop \gset

-- ---------------------------------------------------------------------------
-- Sync: completed after cancel is kept and flagged
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew('visit_start', :'visit_cancel'::uuid, gen_random_uuid(), now(), null, '{}'::jsonb),
  'applied',
  'crew can start before the office cancels'
);
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format($$ select public.cancel_visit(%L, 'customer called mid-job') $$, :'visit_cancel'),
  'office can cancel a started visit'
);
select tests.clear_auth();
select is(
  (select status::text from public.visits where id = :'visit_cancel'::uuid),
  'cancelled',
  'mid-visit cancel marks the stop cancelled'
);

select gen_random_uuid() as photo_cancel \gset
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_cancel' || '/' || :'photo_cancel' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_cancel'::uuid, :'photo_cancel'::uuid, now(), null,
    jsonb_build_object('photo_kind', 'after', 'taken_at', now())
  ),
  'applied',
  'mid-visit cancel still accepts an after photo'
);
select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', gen_random_uuid(),
  'kind', 'visit_finish',
  'visit_id', :'visit_cancel',
  'occurred_at', now()
))) as sync_cancel \gset
select is((:'sync_cancel')::jsonb->'results'->0->>'status', 'applied', 'sync finish after cancel applies');
select tests.clear_auth();
select is(
  (select status::text from public.visits where id = :'visit_cancel'::uuid),
  'completed',
  'completion after cancel is kept'
);
select is(
  (select completed_after_cancel from public.visits where id = :'visit_cancel'::uuid),
  true,
  'completion after cancel is flagged'
);

-- ---------------------------------------------------------------------------
-- Sync: past-midnight finish keeps the visit date and pack membership
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_start', :'visit_midnight'::uuid, gen_random_uuid(),
    (:'yesterday'::date + time '16:00')::timestamp at time zone 'America/Chicago',
    null, '{}'::jsonb
  ),
  'applied',
  'crew can start a visit on yesterday'
);
select gen_random_uuid() as photo_midnight \gset
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_midnight' || '/' || :'photo_midnight' || '.jpg');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_midnight'::uuid, :'photo_midnight'::uuid,
    (:'today'::date + time '00:40')::timestamp at time zone 'America/Chicago',
    null, jsonb_build_object('photo_kind', 'after')
  ),
  'applied',
  'past-midnight visit can record an after photo'
);
select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', gen_random_uuid(),
  'kind', 'visit_finish',
  'visit_id', :'visit_midnight',
  'occurred_at', (:'today'::date + time '00:45')::timestamp at time zone 'America/Chicago'
))) as sync_midnight \gset
select is((:'sync_midnight')::jsonb->'results'->0->>'status', 'applied', 'past-midnight finish syncs');
select tests.clear_auth();
select is(
  (select scheduled_date from public.visits where id = :'visit_midnight'::uuid),
  :'yesterday'::date,
  'past-midnight finish keeps the original scheduled date'
);
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.crew_day_pack(:'yesterday'::date) -> 'visits') v
    where v ->> 'id' = :'visit_midnight'
  ),
  'past-midnight visit stays in its original day pack'
);
select tests.clear_auth();

-- ---------------------------------------------------------------------------
-- DB: 12h forgot-to-finish flag
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_start', :'visit_twelve'::uuid, gen_random_uuid(),
    now() - interval '13 hours', null, '{}'::jsonb
  ),
  'applied',
  'crew can start a long-running visit'
);
select gen_random_uuid() as photo_twelve \gset
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_twelve' || '/' || :'photo_twelve' || '.jpg');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_twelve'::uuid, :'photo_twelve'::uuid, now(), null,
    jsonb_build_object('photo_kind', 'after')
  ),
  'applied',
  'long-running visit can record an after photo'
);
select is(
  tests.apply_crew(
    'visit_finish', :'visit_twelve'::uuid, gen_random_uuid(), now(), null, '{}'::jsonb
  ),
  'applied',
  'long-running visit can finish'
);
select tests.clear_auth();
select is(
  (select forgot_to_finish from public.visits where id = :'visit_twelve'::uuid),
  true,
  'finishing after 12 hours sets forgot_to_finish'
);
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'flags') i
    where i ->> 'id' = :'visit_twelve'
      and i ->> 'reason' = 'Forgot to finish'
  ),
  'forgot-to-finish visits land in the flags tray'
);
select tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Cross-crew done message
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'south'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew('visit_start', :'visit_cross'::uuid, gen_random_uuid(), now(), null, '{}'::jsonb),
  'applied',
  'Crew B can start its visit'
);
select gen_random_uuid() as photo_cross \gset
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_cross' || '/' || :'photo_cross' || '.jpg');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_cross'::uuid, :'photo_cross'::uuid, now(), null,
    jsonb_build_object('photo_kind', 'after')
  ),
  'applied',
  'Crew B can record an after photo'
);
select is(
  tests.apply_crew('visit_finish', :'visit_cross'::uuid, gen_random_uuid(), now(), null, '{}'::jsonb),
  'applied',
  'Crew B can finish its visit'
);
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', gen_random_uuid(),
  'kind', 'visit_finish',
  'visit_id', :'visit_cross',
  'occurred_at', now()
))) as sync_cross \gset
select is(
  (:'sync_cross')::jsonb->'results'->0->>'message',
  'Already done by Crew B',
  'finishing a stop another crew completed returns Already done by Crew B'
);
select tests.clear_auth();

select * from finish();
