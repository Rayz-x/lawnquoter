-- S15: gate/dog after-photo rule, dog flag on property, unsafe note/urgent,
-- skipped visits in Needs reschedule.

select plan(15);

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

select tests.create_user('s15-owner@example.com', 'S15 Owner') as owner \gset
select tests.create_user('s15-dispatch@example.com', 'S15 Dispatch') as dispatcher \gset
select tests.create_user('s15-lead@example.com', 'S15 Lead') as lead \gset

select tests.create_org('S15 Org', 's15org', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');

select (timezone('America/Chicago', now()))::date as today \gset

insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (
  :'org'::uuid, 'S15 Account', '555-0115', 's15@example.com',
  's15-bill@example.com', '15 Skip Ln'
) returning id as acct \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code, has_dogs, location
) values (
  :'org'::uuid, :'acct'::uuid, '15 Skip Ln', 'Springfield', 'IL', '62704',
  false, extensions.st_geogfromtext('SRID=4326;POINT(-89.65 39.78)')
) returning id as prop \gset

insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Gate skip') returning id as job_gate \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Dog skip') returning id as job_dog \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Unsafe skip') returning id as job_unsafe \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Weather skip') returning id as job_weather \gset

insert into public.crews (org_id, name)
values (:'org'::uuid, 'S15 Crew')
returning id as crew \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew'::uuid, :'lead'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew'::uuid;

insert into public.routes (org_id, crew_id, date, status, published_at)
values (:'org'::uuid, :'crew'::uuid, :'today'::date, 'published', now())
returning id as route \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
) values
  (:'org'::uuid, :'job_gate'::uuid, :'prop'::uuid, :'route'::uuid, 0, :'today'::date, :'today'::date, 'scheduled', 1, 30)
returning id as visit_gate \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
) values
  (:'org'::uuid, :'job_dog'::uuid, :'prop'::uuid, :'route'::uuid, 1, :'today'::date, :'today'::date, 'scheduled', 1, 30)
returning id as visit_dog \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
) values
  (:'org'::uuid, :'job_unsafe'::uuid, :'prop'::uuid, :'route'::uuid, 2, :'today'::date, :'today'::date, 'scheduled', 1, 30)
returning id as visit_unsafe \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
) values
  (:'org'::uuid, :'job_weather'::uuid, :'prop'::uuid, :'route'::uuid, 3, :'today'::date, :'today'::date, 'scheduled', 1, 30)
returning id as visit_weather \gset

select gen_random_uuid() as client_issue \gset
select gen_random_uuid() as client_after_gate \gset
select gen_random_uuid() as client_after_dog \gset
select gen_random_uuid() as client_skip_gate \gset
select gen_random_uuid() as client_skip_dog \gset
select gen_random_uuid() as client_skip_unsafe_bad \gset
select gen_random_uuid() as client_skip_unsafe \gset
select gen_random_uuid() as client_skip_weather \gset

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');

-- Issue photo alone does not satisfy the after-photo rule for gate skips.
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_gate' || '/' || :'client_issue' || '.jpg');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_gate'::uuid, :'client_issue'::uuid, null, null,
    jsonb_build_object('photo_kind', 'issue')
  ),
  'applied',
  'an issue photo can still be recorded'
);
select throws_ok(
  format(
    $$ select tests.apply_crew('visit_skip', %L, %L, null, null, jsonb_build_object('reason', 'gate_locked')) $$,
    :'visit_gate', :'client_skip_gate'
  ),
  '22023',
  null,
  'a gate skip rejects an issue photo that is not an after photo'
);

insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_gate' || '/' || :'client_after_gate' || '.jpg');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_gate'::uuid, :'client_after_gate'::uuid, null, null,
    jsonb_build_object('photo_kind', 'after')
  ),
  'applied',
  'an after photo for the gate skip records'
);
select is(
  tests.apply_crew(
    'visit_skip', :'visit_gate'::uuid, :'client_skip_gate'::uuid, null, null,
    jsonb_build_object('reason', 'gate_locked')
  ),
  'applied',
  'a gate skip is accepted when an after photo with a file exists'
);

-- Dog skip flags the property and also needs an after photo.
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_dog' || '/' || :'client_after_dog' || '.jpg');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_dog'::uuid, :'client_after_dog'::uuid, null, null,
    jsonb_build_object('photo_kind', 'after')
  ),
  'applied',
  'an after photo for the dog skip records'
);
select is((select has_dogs from public.properties where id = :'prop'::uuid), false,
  'property starts without the dog flag');
select is(
  tests.apply_crew(
    'visit_skip', :'visit_dog'::uuid, :'client_skip_dog'::uuid, null, null,
    jsonb_build_object('reason', 'dog_loose')
  ),
  'applied',
  'a dog skip is accepted with an after photo'
);
select is((select has_dogs from public.properties where id = :'prop'::uuid), true,
  'a dog skip flags the property');

-- Unsafe requires a note; photo is optional; marked urgent in the tray.
select throws_ok(
  format(
    $$ select tests.apply_crew('visit_skip', %L, %L, null, null, jsonb_build_object('reason', 'unsafe')) $$,
    :'visit_unsafe', :'client_skip_unsafe_bad'
  ),
  '22023',
  null,
  'an unsafe skip without a note is rejected'
);
select is(
  tests.apply_crew(
    'visit_skip', :'visit_unsafe'::uuid, :'client_skip_unsafe'::uuid, null, null,
    jsonb_build_object('reason', 'unsafe', 'note', 'loose board on porch')
  ),
  'applied',
  'an unsafe skip with a note is accepted without a photo'
);
select is(
  (select crew_note from public.visits where id = :'visit_unsafe'::uuid),
  'loose board on porch',
  'an unsafe skip stores the note on the visit'
);

select is(
  tests.apply_crew(
    'visit_skip', :'visit_weather'::uuid, :'client_skip_weather'::uuid, null, null,
    jsonb_build_object('reason', 'weather')
  ),
  'applied',
  'a weather skip needs no photo or note'
);

select tests.clear_auth();
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');

select is((public.office_attention_tray(:'today'::date) -> 'counts' ->> 'needs_reschedule')::int, 4,
  'skipped visits land in Needs reschedule');
select is((
  select i ->> 'reason'
  from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'needs_reschedule') i
  where i ->> 'id' = :'visit_unsafe'
), 'Unsafe — urgent', 'unsafe skips are labeled urgent in the tray');
select is((
  select i ->> 'id'
  from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'needs_reschedule') i
  limit 1
), :'visit_unsafe'::text, 'urgent unsafe skips sort first in Needs reschedule');

select * from finish();
