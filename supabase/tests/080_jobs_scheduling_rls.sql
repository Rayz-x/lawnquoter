-- Access tests for agreements, jobs, crews, routes, visits, and visit_tasks.
--
-- Visit-generation idempotency and anon EXECUTE on the scheduling RPCs
-- (convert quote, generate visits, assign, reorder, publish) are covered when
-- those functions are appended to 20261009190000_jobs_scheduling.sql.
-- Quote price and cost denial is covered by the privilege-gaps tests; this
-- file does not duplicate them.

select plan(97);

-- Gate codes live on property_access. These helpers read that table.
create or replace function tests.note_property_access(p_org uuid, p_property uuid, p_code text, p_notes text)
returns void
language plpgsql
as $$
begin
  insert into public.property_access (property_id, org_id, gate_code, access_notes)
  values (p_property, p_org, p_code, p_notes)
  on conflict (property_id) do update
    set gate_code = excluded.gate_code,
        access_notes = excluded.access_notes;
end;
$$;

create or replace function tests.gate_code(p_property uuid)
returns text
language sql
stable
as $$
  select gate_code from public.property_access where property_id = p_property;
$$;

create or replace function tests.access_notes(p_property uuid)
returns text
language sql
stable
as $$
  select access_notes from public.property_access where property_id = p_property;
$$;

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

grant execute on function tests.note_property_access(uuid, uuid, text, text) to public;
grant execute on function tests.gate_code(uuid) to public;
grant execute on function tests.access_notes(uuid) to public;
grant execute on function tests.expect_property_access(boolean, uuid, uuid, text) to public;

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('o2@example.com', 'Owner Two') as owner2 \gset
select tests.create_user('s1@example.com', 'Sales One') as sales1 \gset
select tests.create_user('d1@example.com', 'Dispatch One') as dispatcher1 \gset
select tests.create_user('r1@example.com', 'Read One') as read1 \gset
select tests.create_user('ca@example.com', 'Crew A') as crew_a \gset
select tests.create_user('cb@example.com', 'Crew B') as crew_b \gset
select tests.create_user('la@example.com', 'Lead A') as lead_a \gset

select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Two', 'two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'dispatcher1'::uuid, 'dispatcher');
select tests.add_member(:'org1'::uuid, :'read1'::uuid, 'read_only');
select tests.add_member(:'org1'::uuid, :'crew_a'::uuid, 'crew');
select tests.add_member(:'org1'::uuid, :'crew_b'::uuid, 'crew');
select tests.add_member(:'org1'::uuid, :'lead_a'::uuid, 'crew_lead');

-- Org default timezone is America/Chicago. The crew window uses that clock,
-- not the session date.
select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date - 1) as yesterday \gset
select (:'today'::date + 1) as tomorrow \gset
select (:'today'::date + 2) as later \gset

select is(
  (
    select count(*)
    from public.orgs o
    where o.timezone is null
       or not exists (
         select 1 from pg_timezone_names n where n.name = o.timezone
       )
  ),
  0::bigint,
  'stored org timezones are known names'
);
select throws_ok(
  format($$ update public.orgs set timezone = 'Not/AZone' where id = %L $$, :'org1'),
  '22023',
  null,
  'an invalid timezone is rejected'
);

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (:'org1'::uuid, 'Pat Customer', '555-0100', 'pat@example.com', 'billing@example.com', '1 Bill St')
returning id as acct \gset

insert into public.contacts (org_id, account_id, first_name, last_name, email, phone, is_primary, is_billing)
values (:'org1'::uuid, :'acct'::uuid, 'Pat', 'Customer', 'pat.contact@example.com', '555-0101', true, true);

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code,
  gate_width_in, has_dogs, slope, has_stairs, crew_notes
) values (
  :'org1'::uuid, :'acct'::uuid, '1 Main', 'Springfield', 'IL', '62704',
  36, true, 'steep', true, 'mow back first'
) returning id as prop_mine \gset
select tests.note_property_access(:'org1'::uuid, :'prop_mine'::uuid, '1111', 'side gate');

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org1'::uuid, :'acct'::uuid, '2 Other', 'Springfield', 'IL', '62704'
) returning id as prop_other \gset
select tests.note_property_access(:'org1'::uuid, :'prop_other'::uuid, '9999', null);

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org1'::uuid, :'acct'::uuid, '3 Later', 'Springfield', 'IL', '62704'
) returning id as prop_far \gset
select tests.note_property_access(:'org1'::uuid, :'prop_far'::uuid, '8888', null);

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org1'::uuid, :'acct'::uuid, '4 Open', 'Springfield', 'IL', '62704'
) returning id as prop_open \gset
select tests.note_property_access(:'org1'::uuid, :'prop_open'::uuid, '7777', null);

select tests.clear_auth();

insert into public.agreements (
  org_id, account_id, property_id, kind, service_kind, frequency,
  start_date, preferred_dow, status, notes_office
) values (
  :'org1'::uuid, :'acct'::uuid, :'prop_mine'::uuid, 'recurring', 'mowing', 'weekly',
  :'today'::date, 1, 'active', 'keep'
) returning id as agr \gset

insert into public.jobs (org_id, agreement_id, property_id, title, status)
values (:'org1'::uuid, :'agr'::uuid, :'prop_mine'::uuid, 'Weekly mow', 'scheduled')
returning id as job_mine \gset

insert into public.jobs (org_id, property_id, title)
values (:'org1'::uuid, :'prop_other'::uuid, 'Other yard')
returning id as job_other \gset

insert into public.jobs (org_id, property_id, title)
values (:'org1'::uuid, :'prop_far'::uuid, 'Later yard')
returning id as job_far \gset

insert into public.jobs (org_id, property_id, title)
values (:'org1'::uuid, :'prop_open'::uuid, 'Unassigned yard')
returning id as job_open \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('jobs', 'visits')
      and column_name = 'require_after_photo'
  ),
  0::bigint,
  'jobs and visits have no require_after_photo column'
);
select throws_ok(
  format($$ update public.jobs set status = 'completed' where id = %L $$, :'job_mine'),
  '42501',
  null,
  'job status cannot be written directly'
);

insert into public.crews (org_id, name)
values (:'org1'::uuid, 'North')
returning id as crew_north \gset

insert into public.crews (org_id, name)
values (:'org1'::uuid, 'South')
returning id as crew_south \gset

insert into public.crews (org_id, name)
values (:'org1'::uuid, 'Spare')
returning id as crew_spare \gset

insert into public.crew_members (org_id, crew_id, profile_id) values
  (:'org1'::uuid, :'crew_north'::uuid, :'crew_a'::uuid),
  (:'org1'::uuid, :'crew_north'::uuid, :'lead_a'::uuid),
  (:'org1'::uuid, :'crew_south'::uuid, :'crew_b'::uuid);

select tests.clear_auth();
update public.crews set default_lead_id = :'lead_a'::uuid where id = :'crew_north'::uuid;
select throws_ok(
  format($$ update public.jobs set status = 'completed' where id = %L $$, :'job_mine'),
  '22023',
  null,
  'a job cannot be completed before an after photo exists'
);

insert into public.routes (org_id, crew_id, date, status)
values (:'org1'::uuid, :'crew_north'::uuid, :'today'::date, 'published')
returning id as route_today \gset

insert into public.routes (org_id, crew_id, date, status)
values (:'org1'::uuid, :'crew_north'::uuid, :'yesterday'::date, 'published')
returning id as route_yest \gset

insert into public.routes (org_id, crew_id, date, status)
values (:'org1'::uuid, :'crew_north'::uuid, :'tomorrow'::date, 'draft')
returning id as route_tom \gset

insert into public.routes (org_id, crew_id, date, status)
values (:'org1'::uuid, :'crew_north'::uuid, :'later'::date, 'published')
returning id as route_far \gset

insert into public.routes (org_id, crew_id, date, status)
values (:'org1'::uuid, :'crew_south'::uuid, :'today'::date, 'published')
returning id as route_south \gset

insert into public.routes (org_id, crew_id, date, status)
values (:'org1'::uuid, :'crew_spare'::uuid, :'today'::date, 'draft')
returning id as route_draft \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, route_id, sort,
  occurrence_date, scheduled_date, window_start, window_end, status, crew_size, budget_minutes
) values (
  :'org1'::uuid, :'agr'::uuid, :'job_mine'::uuid, :'prop_mine'::uuid, :'route_today'::uuid, 1,
  :'today'::date, :'today'::date, '08:00', '10:00', 'scheduled', 2, 45
) returning id as visit_mine \gset

insert into public.visit_office_notes (visit_id, org_id, note)
values (:'visit_mine'::uuid, :'org1'::uuid, 'office note');

insert into public.visits (
  org_id, agreement_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org1'::uuid, :'agr'::uuid, :'job_mine'::uuid, :'prop_mine'::uuid, :'route_yest'::uuid,
  :'yesterday'::date, :'yesterday'::date, 'scheduled'
) returning id as visit_yest \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org1'::uuid, :'agr'::uuid, :'job_mine'::uuid, :'prop_mine'::uuid, :'route_tom'::uuid,
  :'tomorrow'::date, :'tomorrow'::date, 'scheduled'
) returning id as visit_tom \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org1'::uuid, :'job_far'::uuid, :'prop_far'::uuid, :'route_far'::uuid,
  :'later'::date, :'later'::date, 'scheduled'
) returning id as visit_far \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, status
) values (
  :'org1'::uuid, :'job_other'::uuid, :'prop_other'::uuid, :'route_south'::uuid,
  :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_other \gset

insert into public.visits (
  org_id, job_id, property_id, occurrence_date, scheduled_date, status
) values (
  :'org1'::uuid, :'job_open'::uuid, :'prop_open'::uuid,
  :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_open \gset

select throws_ok(
  format($$ update public.visits set status = 'completed' where id = %L $$, :'visit_mine'),
  '22023',
  null,
  'a visit cannot be completed before an after photo exists'
);

insert into public.visit_tasks (org_id, visit_id, label, quantity_text, sort)
values (:'org1'::uuid, :'visit_mine'::uuid, 'Mow', '6000 sq ft', 0)
returning id as task_mine \gset

insert into public.visit_tasks (org_id, visit_id, label, sort)
values (:'org1'::uuid, :'visit_other'::uuid, 'Other mow', 0);

select is((select count(*) from public.visits), 6::bigint, 'office sees every visit');
select is((select count(*) from public.routes where status = 'draft'), 2::bigint, 'office sees draft routes');

-- Cross-org -----------------------------------------------------------------
select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.agreements), 0::bigint, 'other org sees no agreements');
select is((select count(*) from public.jobs), 0::bigint, 'other org sees no jobs');
select is((select count(*) from public.crews), 0::bigint, 'other org sees no crews');
select is((select count(*) from public.crew_members), 0::bigint, 'other org sees no crew members');
select is((select count(*) from public.routes), 0::bigint, 'other org sees no routes');
select is((select count(*) from public.visits), 0::bigint, 'other org sees no visits');
select is((select count(*) from public.visit_tasks), 0::bigint, 'other org sees no visit tasks');
select throws_ok(
  format(
    $$ insert into public.agreements (org_id, account_id, property_id, kind, start_date) values (%L, %L, %L, 'one_time', %L) $$,
    :'org1', :'acct', :'prop_mine', :'today'
  ),
  '42501',
  null,
  'cannot create an agreement in another org'
);

-- Crew A: own crew, in window, not drafts -----------------------------------
select tests.authenticate_as(:'crew_a'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.visits), 2::bigint, 'crew sees only in-window visits on their crew');
select is((select count(*) from public.routes), 2::bigint, 'crew sees only in-window routes on their crew');
select is((select count(*) from public.routes where status = 'draft'), 0::bigint, 'crew cannot read draft routes');
select is((select count(*) from public.visits where id = :'visit_tom'::uuid), 0::bigint, 'crew cannot read a visit on a draft route');
select is((select count(*) from public.jobs), 1::bigint, 'crew sees only jobs on those visits');
select is((select count(*) from public.visit_tasks), 1::bigint, 'crew sees only tasks on those visits');
select is((select count(*) from public.agreements), 0::bigint, 'crew cannot read agreements');
select is((select count(*) from public.crews), 1::bigint, 'crew can read their own crew');
select is((select count(*) from public.crew_members), 2::bigint, 'crew can read their own roster');
select is((select count(*) from public.crews where id = :'crew_south'::uuid), 0::bigint, 'crew cannot read another crew');
select is((select id from public.visits where id = :'visit_mine'::uuid), :'visit_mine'::uuid, 'crew sees today''s visit');
select is((select budget_minutes from public.visits where id = :'visit_mine'::uuid), 45, 'crew can read the minute budget');
select is((select count(*) from public.visits where id = :'visit_other'::uuid), 0::bigint, 'crew cannot read another crew''s visit');
select is((select count(*) from public.routes where id = :'route_south'::uuid), 0::bigint, 'crew cannot read another crew''s route');
select is((select count(*) from public.visits where id = :'visit_far'::uuid), 0::bigint, 'crew cannot read a visit outside the date window');
select is((select count(*) from public.visits where id = :'visit_open'::uuid), 0::bigint, 'crew cannot read a visit that is not routed');
select is(
  (select tests.gate_code(id) = '1111'
      and gate_width_in = 36
      and has_dogs
      and slope = 'steep'
      and has_stairs
      and tests.access_notes(id) = 'side gate'
      and crew_notes = 'mow back first'
   from public.properties where id = :'prop_mine'::uuid),
  true,
  'crew reads access fields for a property on their routed visit'
);
select is((select count(*) from public.properties where id = :'prop_other'::uuid), 0::bigint, 'crew cannot read another crew''s property');
select is((select count(*) from public.properties where id = :'prop_far'::uuid), 0::bigint, 'crew cannot read a property whose visit is outside the window');
select is((select count(*) from public.properties where id = :'prop_open'::uuid), 0::bigint, 'crew cannot read a property that is not routed');
select tests.expect_property_access(
  true, :'org1'::uuid, :'prop_mine'::uuid,
  'property access helper allows the assigned property'
);
select tests.expect_property_access(
  false, :'org1'::uuid, :'prop_other'::uuid,
  'property access helper denies another crew''s property'
);
select tests.expect_property_access(
  false, :'org1'::uuid, :'prop_far'::uuid,
  'property access helper denies a property outside the window'
);

select is((select phone from public.accounts), null, 'crew cannot select customer phone');
select is((select email from public.accounts), null, 'crew cannot select customer email');
select is((select billing_email from public.accounts), null, 'crew cannot select billing email');
select is((select billing_address_line1 from public.accounts), null, 'crew cannot select billing address');
select is((select first_name from public.contacts), null, 'crew cannot select contact first name');
select is((select last_name from public.contacts), null, 'crew cannot select contact last name');
select is((select phone from public.contacts), null, 'crew cannot select contact phone');
select is((select email from public.contacts), null, 'crew cannot select contact email');
select is(
  (select a.phone
     from public.visits v
     join public.properties p on p.id = v.property_id
     left join public.accounts a on a.id = p.account_id
    where v.id = :'visit_mine'::uuid),
  null,
  'crew cannot read customer phone by joining a visit to the account'
);
select is(
  (select c.first_name
     from public.properties p
     left join public.contacts c on c.account_id = p.account_id
    where p.id = :'prop_mine'::uuid),
  null,
  'crew cannot read contact name by joining a property'
);

select throws_ok(
  format(
    $$ insert into public.agreements (org_id, account_id, property_id, kind, start_date) values (%L, %L, %L, 'one_time', %L) $$,
    :'org1', :'acct', :'prop_mine', :'today'
  ),
  '42501', null, 'crew cannot insert agreements'
);
select throws_ok(
  format(
    $$ insert into public.jobs (org_id, property_id, title) values (%L, %L, 'Crew job') $$,
    :'org1', :'prop_mine'
  ),
  '42501', null, 'crew cannot insert jobs'
);
select throws_ok(
  format(
    $$ insert into public.routes (org_id, crew_id, date) values (%L, %L, %L) $$,
    :'org1', :'crew_north', :'later'
  ),
  '42501', null, 'crew cannot insert routes'
);
select throws_ok(
  format(
    $$ insert into public.visits (org_id, job_id, property_id, scheduled_date) values (%L, %L, %L, %L) $$,
    :'org1', :'job_open', :'prop_open', :'today'
  ),
  '42501', null, 'crew cannot insert visits'
);

select is((select count(*) from public.visit_office_notes), 0::bigint, 'crew cannot read office visit notes');
select throws_ok(
  format($$ update public.routes set status = 'done' where id = %L $$, :'route_today'),
  '42501', null, 'crew cannot update route status'
);
select throws_ok(
  format($$ update public.visits set status = 'completed' where id = %L $$, :'visit_mine'),
  '42501', null, 'crew cannot mark a visit completed'
);
select throws_ok(
  format($$ update public.visits set scheduled_date = %L where id = %L $$, :'later', :'visit_mine'),
  '42501', null, 'crew cannot set scheduled_date'
);
update public.visits set window_start = '11:00' where id = :'visit_mine'::uuid;
select is((select window_start from public.visits where id = :'visit_mine'::uuid), '08:00'::time, 'crew cannot update the visit window');
update public.agreements set notes_office = 'crew' where id = :'agr'::uuid;
update public.jobs set title = 'crew' where id = :'job_mine'::uuid;
select is((select title from public.jobs where id = :'job_mine'::uuid), 'Weekly mow', 'crew cannot update jobs');

delete from public.visits where id = :'visit_mine'::uuid;
delete from public.routes where id = :'route_today'::uuid;
delete from public.jobs where id = :'job_mine'::uuid;
delete from public.agreements where id = :'agr'::uuid;
select is((select count(*) from public.visits where id = :'visit_mine'::uuid), 1::bigint, 'crew cannot delete visits');

select tests.clear_auth();
select is((select notes_office from public.agreements where id = :'agr'::uuid), 'keep', 'crew cannot update agreements');
select is((select count(*) from public.agreements where id = :'agr'::uuid), 1::bigint, 'crew cannot delete agreements');
select is((select count(*) from public.jobs where id = :'job_mine'::uuid), 1::bigint, 'crew cannot delete jobs');
select is((select count(*) from public.routes where id = :'route_today'::uuid), 1::bigint, 'crew cannot delete routes');

-- Other crew and the lead ---------------------------------------------------
select tests.authenticate_as(:'crew_b'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.visits where id = :'visit_other'::uuid), 1::bigint, 'a crew sees its own visit');
select is((select count(*) from public.visits where id = :'visit_mine'::uuid), 0::bigint, 'a crew cannot read the other crew''s visit');

select tests.authenticate_as(:'lead_a'::uuid, :'org1'::uuid, 'crew_lead');
select is((select count(*) from public.visits where id = :'visit_mine'::uuid), 1::bigint, 'crew lead sees their crew''s visit');
select tests.expect_property_access(
  true, :'org1'::uuid, :'prop_mine'::uuid,
  'crew lead can read access for their crew''s property'
);
select tests.expect_property_access(
  false, :'org1'::uuid, :'prop_other'::uuid,
  'crew lead cannot read access for another crew''s property'
);
select throws_ok(
  format(
    $$ insert into public.visits (org_id, job_id, property_id, scheduled_date) values (%L, %L, %L, %L) $$,
    :'org1', :'job_open', :'prop_open', :'today'
  ),
  '42501', null, 'crew lead cannot insert visits'
);
select throws_ok(
  format($$ update public.visits set route_id = %L where id = %L $$, :'route_south', :'visit_mine'),
  '42501', null, 'crew lead cannot set route_id'
);

-- Sales converts later; dispatcher owns crews --------------------------------
select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
select throws_ok(
  format(
    $$ insert into public.agreements (org_id, account_id, property_id, kind, start_date) values (%L, %L, %L, 'one_time', %L) $$,
    :'org1', :'acct', :'prop_mine', :'today'
  ),
  '42501',
  null,
  'sales cannot create an agreement'
);
select throws_ok(
  format(
    $$ insert into public.jobs (org_id, property_id, title, status) values (%L, %L, 'Direct job', 'in_progress') $$,
    :'org1', :'prop_mine'
  ),
  '42501',
  null,
  'sales cannot insert a job'
);
select throws_ok(
  format($$ insert into public.crews (org_id, name) values (%L, 'Sales crew') $$, :'org1'),
  '42501', null, 'sales cannot create a crew'
);
select throws_ok(
  format(
    $$ update public.visits set route_id = %L, scheduled_date = %L where id = %L $$,
    :'route_today', :'today', :'visit_mine'
  ),
  '42501', null, 'sales cannot set the route or scheduled date'
);
delete from public.visits where id = :'visit_mine'::uuid;
select is((select count(*) from public.visits where id = :'visit_mine'::uuid), 1::bigint, 'sales cannot delete visits');

select tests.authenticate_as(:'dispatcher1'::uuid, :'org1'::uuid, 'dispatcher');
select lives_ok(
  format($$ insert into public.crews (org_id, name) values (%L, 'Relief') $$, :'org1'),
  'dispatcher can create a crew'
);

select lives_ok(
  format($$ update public.visits set window_end = '12:00' where id = %L $$, :'visit_mine'),
  'dispatcher can update the visit window'
);
select throws_ok(
  format($$ delete from public.visits where id = %L $$, :'visit_mine'),
  '42501',
  null,
  'a visit on an agreement cannot be deleted'
);
select throws_ok(
  format(
    $$ delete from public.crew_members where crew_id = %L and profile_id = %L $$,
    :'crew_north', :'lead_a'
  ),
  '23514',
  null,
  'the default lead cannot be removed'
);
select throws_ok(
  format($$ update public.visits set status = 'completed' where id = %L $$, :'visit_mine'),
  '42501', null, 'dispatcher cannot mark a visit completed directly'
);

select tests.authenticate_as(:'read1'::uuid, :'org1'::uuid, 'read_only');
select ok((select count(*) from public.visits) > 0, 'read_only can read visits');
select throws_ok(
  format(
    $$ insert into public.agreements (org_id, account_id, property_id, kind, start_date) values (%L, %L, %L, 'one_time', %L) $$,
    :'org1', :'acct', :'prop_mine', :'today'
  ),
  '42501', null, 'read_only cannot create an agreement'
);

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select tests.expect_property_access(
  true, :'org1'::uuid, :'prop_other'::uuid,
  'office can read property access for any property in the org'
);

select tests.clear_auth();
update public.visits set status = 'cancelled' where id in (:'visit_mine'::uuid, :'visit_yest'::uuid);
select tests.authenticate_as(:'crew_a'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.visits where id = :'visit_mine'::uuid), 0::bigint, 'crew cannot read a cancelled visit');
select tests.expect_property_access(
  false, :'org1'::uuid, :'prop_mine'::uuid,
  'a cancelled stop does not keep the gate code readable'
);
select tests.clear_auth();
update public.visits set status = 'scheduled' where id in (:'visit_mine'::uuid, :'visit_yest'::uuid);

-- JWT role crew is not enough once the membership row is gone.
select tests.clear_auth();
delete from public.crew_members where profile_id = :'crew_a'::uuid;
select tests.authenticate_as(:'crew_a'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.visits), 0::bigint, 'crew without a live crew membership sees no visits');
select tests.expect_property_access(
  false, :'org1'::uuid, :'prop_mine'::uuid,
  'property access helper denies a crew member who is not on the crew'
);

select tests.clear_auth();
insert into public.agreements (org_id, account_id, property_id, kind, start_date)
values (:'org1'::uuid, :'acct'::uuid, :'prop_mine'::uuid, 'one_time', :'today'::date)
returning id as agr_job_del \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org1'::uuid, :'agr_job_del'::uuid, :'prop_mine'::uuid, 'Cascade job')
returning id as job_del \gset
insert into public.visits (org_id, agreement_id, job_id, property_id, occurrence_date, status)
values (
  :'org1'::uuid, :'agr_job_del'::uuid, :'job_del'::uuid, :'prop_mine'::uuid, :'today'::date, 'scheduled'
) returning id as visit_job_del \gset
delete from public.jobs where id = :'job_del'::uuid;
select is(
  (select count(*) from public.visits where id = :'visit_job_del'::uuid),
  0::bigint,
  'deleting a job cascades its visits'
);

insert into public.agreements (org_id, account_id, property_id, kind, start_date)
values (:'org1'::uuid, :'acct'::uuid, :'prop_mine'::uuid, 'one_time', :'today'::date)
returning id as agr_del \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org1'::uuid, :'agr_del'::uuid, :'prop_mine'::uuid, 'Cascade agreement')
returning id as job_agr_del \gset
insert into public.visits (org_id, agreement_id, job_id, property_id, occurrence_date, status)
values (
  :'org1'::uuid, :'agr_del'::uuid, :'job_agr_del'::uuid, :'prop_mine'::uuid, :'today'::date, 'scheduled'
) returning id as visit_agr_del \gset
delete from public.agreements where id = :'agr_del'::uuid;
select is(
  (select count(*) from public.visits where id = :'visit_agr_del'::uuid)
  + (select count(*) from public.jobs where id = :'job_agr_del'::uuid),
  0::bigint,
  'deleting an agreement cascades its job and visits'
);

select tests.authenticate_anon();
select throws_ok('select id from public.agreements', '42501', null, 'anon cannot read agreements');
select throws_ok('select id from public.jobs', '42501', null, 'anon cannot read jobs');
select throws_ok('select id from public.crews', '42501', null, 'anon cannot read crews');
select throws_ok('select id from public.crew_members', '42501', null, 'anon cannot read crew members');
select throws_ok('select id from public.routes', '42501', null, 'anon cannot read routes');
select throws_ok('select id from public.visits', '42501', null, 'anon cannot read visits');
select throws_ok('select id from public.visit_tasks', '42501', null, 'anon cannot read visit tasks');

select * from finish();
