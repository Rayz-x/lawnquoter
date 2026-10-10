-- S08: gate codes follow the org clock (route date ± 1), overdue pins keep
-- codes, and a phone clock set ahead does not unlock extra codes.

select plan(10);

create or replace function tests.expect_property_access(
  p_expect boolean, p_org uuid, p_property uuid, p_desc text
) returns text
language plpgsql
as $$
declare
  v boolean;
begin
  execute 'select private.can_read_property_access($1, $2)' into v using p_org, p_property;
  return is(v, p_expect, p_desc);
end;
$$;
grant execute on function tests.expect_property_access(boolean, uuid, uuid, text) to public;

create or replace function tests.apply_crew(
  p_kind text, p_visit uuid, p_client uuid,
  p_occurred timestamptz, p_device timestamptz, p_payload jsonb
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

select tests.create_user('owner@gate.example', 'Gate Owner') as owner \gset
select tests.create_user('lead@gate.example', 'Gate Lead') as lead \gset
select tests.create_org('Gate Co', 'gate-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date - 3) as older \gset
select (:'today'::date + 1) as tomorrow \gset
select (:'today'::date + 2) as later \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Gate Customer') returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Today St', 'Springfield', 'IL', '62704')
returning id as prop_today \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '2 Overdue St', 'Springfield', 'IL', '62704')
returning id as prop_overdue \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '3 Later St', 'Springfield', 'IL', '62704')
returning id as prop_later \gset

insert into public.property_access (property_id, org_id, gate_code) values
  (:'prop_today'::uuid, :'org'::uuid, '1111'),
  (:'prop_overdue'::uuid, :'org'::uuid, '2222'),
  (:'prop_later'::uuid, :'org'::uuid, '3333');

insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop_today'::uuid, 'Today') returning id as job_today \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop_overdue'::uuid, 'Overdue') returning id as job_overdue \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop_later'::uuid, 'Later') returning id as job_later \gset

insert into public.crews (org_id, name) values (:'org'::uuid, 'North') returning id as crew \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew'::uuid, :'lead'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew'::uuid;

insert into public.routes (org_id, crew_id, date, status) values
  (:'org'::uuid, :'crew'::uuid, :'today'::date, 'published'),
  (:'org'::uuid, :'crew'::uuid, :'tomorrow'::date, 'published'),
  (:'org'::uuid, :'crew'::uuid, :'older'::date, 'published'),
  (:'org'::uuid, :'crew'::uuid, :'later'::date, 'published');

select id as route_today from public.routes where date = :'today'::date and crew_id = :'crew'::uuid \gset
select id as route_tomorrow from public.routes where date = :'tomorrow'::date and crew_id = :'crew'::uuid \gset
select id as route_older from public.routes where date = :'older'::date and crew_id = :'crew'::uuid \gset
select id as route_later from public.routes where date = :'later'::date and crew_id = :'crew'::uuid \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status, sort
) values
  (:'org'::uuid, :'job_today'::uuid, :'prop_today'::uuid, :'route_today'::uuid,
   :'today'::date, :'today'::date, 'scheduled', 1),
  (:'org'::uuid, :'job_overdue'::uuid, :'prop_overdue'::uuid, :'route_older'::uuid,
   :'older'::date, :'older'::date, 'in_progress', 1),
  (:'org'::uuid, :'job_later'::uuid, :'prop_later'::uuid, :'route_later'::uuid,
   :'later'::date, :'later'::date, 'scheduled', 1),
  (:'org'::uuid, :'job_today'::uuid, :'prop_today'::uuid, :'route_tomorrow'::uuid,
   :'tomorrow'::date, :'tomorrow'::date, 'scheduled', 1);

select id as visit_overdue from public.visits where property_id = :'prop_overdue'::uuid \gset

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');

select throws_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'later'),
  '22023', null,
  'a phone clock +1 day still cannot open the +2 pack window'
);

select public.crew_day_pack(:'tomorrow'::date) as pack_tomorrow \gset
select is((:'pack_tomorrow')::jsonb->>'server_today', :'today',
  'the pack reports org-local today, not the phone pack date');
select ok(position('3333' in :'pack_tomorrow') = 0,
  'phone clock +1 day gets no extra codes from a +2 route');
select ok(position('1111' in :'pack_tomorrow') > 0,
  'tomorrow''s in-window route still carries its gate code');

select public.crew_day_pack(:'today'::date) as pack_today \gset
select ok(
  (
    select (v->'property'->>'gate_code') = '2222'
    from jsonb_array_elements((:'pack_today')::jsonb->'visits') v
    where (v->'property'->>'id') = :'prop_overdue'
  ),
  'overdue exception keeps the pinned gate code in today''s pack'
);
select tests.expect_property_access(
  true, :'org'::uuid, :'prop_overdue'::uuid,
  'overdue exception pins property_access for the active stop'
);
select tests.expect_property_access(
  false, :'org'::uuid, :'prop_later'::uuid,
  'a +2 route does not unlock property_access gate codes'
);

select gen_random_uuid() as client_skew \gset
select is(
  tests.apply_crew(
    'visit_pause', :'visit_overdue'::uuid, :'client_skew'::uuid,
    now() - interval '2 hours', now() - interval '10 minutes', '{}'::jsonb
  ),
  'applied',
  'a skewed device clock is accepted'
);
select ok(
  (select device_clock_skewed from public.visit_events where client_id = :'client_skew'::uuid),
  'skew above 5 minutes is flagged'
);

select tests.clear_auth();
update public.visits set status = 'cancelled' where id = :'visit_overdue'::uuid;
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select tests.expect_property_access(
  false, :'org'::uuid, :'prop_overdue'::uuid,
  'leaving the overdue stop drops the gate-code pin'
);

select * from finish();
