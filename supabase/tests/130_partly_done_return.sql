-- S12: Partly done finish creates an unassigned return visit and holds billing.

select plan(12);

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

select has_column('public', 'visits', 'billing_held', 'billing_held exists');
select has_column('public', 'visits', 'partly_done_reason', 'partly_done_reason exists');
select has_column('public', 'visits', 'return_of_visit_id', 'return_of_visit_id exists');

select tests.create_user('partly-owner@example.com', 'Partly Owner') as owner \gset
select tests.create_user('partly-dispatch@example.com', 'Partly Dispatch') as dispatcher \gset
select tests.create_user('partly-lead@example.com', 'Partly Lead') as lead \gset
select tests.create_org('Partly Co', 'partly-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;
select private.org_local_today(:'org'::uuid) as today \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (:'org'::uuid, 'Partly Account', '555-0121', 'partly@example.com', 'bill@example.com', '1 Bill St')
returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '21 Return Ln', 'Springfield', 'IL', '62701')
returning id as prop \gset
select tests.clear_auth();

insert into public.crews (org_id, name)
values (:'org'::uuid, 'Partly Crew')
returning id as crew_id \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew_id'::uuid, :'lead'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew_id'::uuid;
insert into public.jobs (org_id, property_id, title, status)
values (:'org'::uuid, :'prop'::uuid, 'Mow front', 'scheduled')
returning id as job_id \gset
insert into public.routes (org_id, crew_id, date, status, revision)
values (:'org'::uuid, :'crew_id'::uuid, :'today'::date, 'published', 1)
returning id as route_id \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort,
  occurrence_date, scheduled_date, status, crew_size, budget_minutes
) values (
  :'org'::uuid, :'job_id'::uuid, :'prop'::uuid, :'route_id'::uuid, 0,
  :'today'::date, :'today'::date, 'scheduled', 1, 45
) returning id as visit_id \gset
insert into public.visit_tasks (org_id, visit_id, label, sort)
values
  (:'org'::uuid, :'visit_id'::uuid, 'Front lawn', 0),
  (:'org'::uuid, :'visit_id'::uuid, 'Back beds', 1);

select gen_random_uuid() as client_start \gset
select gen_random_uuid() as client_after \gset
select gen_random_uuid() as client_bad_finish \gset
select gen_random_uuid() as client_partly \gset

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew('visit_start', :'visit_id'::uuid, :'client_start'::uuid, null, null, '{}'::jsonb),
  'applied',
  'lead can start the visit'
);

select tests.clear_auth();
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_id' || '/' || :'client_after' || '.jpg');
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(
  tests.apply_crew(
    'visit_photo_record', :'visit_id'::uuid, :'client_after'::uuid, null, null,
    jsonb_build_object('photo_kind', 'after')
  ),
  'applied',
  'after photo is recorded before partly done'
);

select throws_ok(
  format(
    $$ select tests.apply_crew('visit_finish', %L, %L, null, null, jsonb_build_object('outcome', 'partly')) $$,
    :'visit_id', :'client_bad_finish'
  ),
  '22023',
  'partly done needs a reason',
  'partly done without a reason is rejected'
);

select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', :'client_partly',
  'kind', 'visit_finish',
  'visit_id', :'visit_id',
  'payload', jsonb_build_object('outcome', 'partly', 'reason', 'Ran out of daylight')
))) as sync_partly \gset
select is((:'sync_partly')::jsonb->'results'->0->>'status', 'applied', 'partly done finish applies');

select tests.clear_auth();
-- Office can see the completed visit and the unassigned return (crew RLS cannot).
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select is(
  (select status::text from public.visits where id = :'visit_id'::uuid),
  'completed',
  'original visit is completed'
);
select is(
  (select billing_held and partly_done_reason = 'Ran out of daylight' from public.visits where id = :'visit_id'::uuid),
  true,
  'original visit is held for billing with the reason'
);

select is(
  (select count(*)::int from public.visits where return_of_visit_id = :'visit_id'::uuid),
  1,
  'a return visit is created'
);
select id as return_id
from public.visits
where return_of_visit_id = :'visit_id'::uuid
\gset

select is(
  (select route_id is null and scheduled_date is null and status = 'scheduled'
     from public.visits where id = :'return_id'::uuid),
  true,
  'return visit is not on a crew route'
);

select ok(exists (
  select 1
  from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'unassigned') i
  where i ->> 'id' = :'return_id'
), 'return visit lands in the unassigned Needs attention bucket');

select * from finish();
