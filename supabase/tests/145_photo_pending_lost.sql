-- S14: offline finish → photo_pending; after photo clears it; lost flag.
select plan(11);

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

select has_column('public', 'visits', 'photo_pending', 'photo_pending exists');
select has_column('public', 'visits', 'photo_lost', 'photo_lost exists');

select tests.create_user('s14-owner@example.com', 'S14 Owner') as owner \gset
select tests.create_user('s14-lead@example.com', 'S14 Lead') as lead \gset
select tests.create_org('S14 Co', 's14co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');

select (timezone('America/Chicago', now()))::date as today \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'S14 Account')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code, location)
values (
  :'org'::uuid, :'acct'::uuid, '12 Photo Ln', 'Springfield', 'IL', '62704',
  extensions.st_geogfromtext('SRID=4326;POINT(-89.65 39.78)')
) returning id as prop \gset

insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Mow pending') returning id as job_a \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Mow lost') returning id as job_b \gset

insert into public.crews (org_id, name)
values (:'org'::uuid, 'S14 Crew')
returning id as crew \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew'::uuid, :'lead'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew'::uuid;

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew'::uuid, :'today'::date, 'published')
returning id as route \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, sort,
  occurrence_date, scheduled_date, status, crew_size
) values (
  :'org'::uuid, :'job_a'::uuid, :'prop'::uuid, :'route'::uuid, 1,
  :'today'::date, :'today'::date, 'scheduled', 1
) returning id as visit_a \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, sort,
  occurrence_date, scheduled_date, status, crew_size
) values (
  :'org'::uuid, :'job_b'::uuid, :'prop'::uuid, :'route'::uuid, 2,
  :'today'::date, :'today'::date, 'scheduled', 1
) returning id as visit_b \gset

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');

-- Visit A: pending → complete when after photo arrives.
select is(
  tests.apply_crew('visit_start', :'visit_a'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, null, null, '{}'::jsonb),
  'applied',
  'lead starts visit A'
);

select is(
  tests.apply_crew('visit_finish', :'visit_a'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid, null, null, '{}'::jsonb),
  'applied',
  'finish without after photo applies as photo pending'
);

select is(
  (select photo_pending and status = 'completed'::public.visit_status from public.visits where id = :'visit_a'::uuid),
  true,
  'visit A is completed with photo_pending'
);

insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_a' || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.jpg');

select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_a'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid, now(), null,
    jsonb_build_object('photo_kind', 'after', 'taken_at', now())
  ),
  'applied',
  'after photo can arrive after finish'
);

select is(
  (select photo_pending = false and photo_lost = false from public.visits where id = :'visit_a'::uuid),
  true,
  'after photo clears photo_pending'
);

-- Visit B: finish then flag lost.
select is(
  tests.apply_crew('visit_start', :'visit_b'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid, null, null, '{}'::jsonb),
  'applied',
  'lead starts visit B'
);

select is(
  tests.apply_crew('visit_finish', :'visit_b'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'::uuid, null, null, '{}'::jsonb),
  'applied',
  'finish visit B without after photo'
);

select is(
  tests.apply_crew(
    'visit_flag_photo_lost', :'visit_b'::uuid, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, null, null, '{}'::jsonb
  ),
  'applied',
  'lost photo can be flagged on a completed visit'
);

select is(
  (select photo_lost and photo_pending from public.visits where id = :'visit_b'::uuid),
  true,
  'flag sets photo_lost and keeps photo_pending'
);

select finish();
