-- Scheduling RPCs: convert, generate, assign, reorder, publish, crews.
-- Quote price and cost denial stays in the privilege-gaps tests.

select plan(107);

select ok(
  not has_function_privilege('anon', 'public.convert_accepted_quote(uuid, text, text, integer, date)', 'execute'),
  'anon has no execute on convert_accepted_quote'
);
select ok(
  not has_function_privilege('anon', 'public.generate_agreement_visits(uuid, date)', 'execute'),
  'anon has no execute on generate_agreement_visits'
);
select ok(
  not has_function_privilege('anon', 'public.assign_visit(uuid, uuid, date, integer)', 'execute'),
  'anon has no execute on assign_visit'
);
select ok(
  not has_function_privilege('anon', 'public.reorder_route_visits(uuid, uuid[])', 'execute'),
  'anon has no execute on reorder_route_visits'
);
select ok(
  not has_function_privilege('anon', 'public.publish_route(uuid)', 'execute'),
  'anon has no execute on publish_route'
);
select ok(
  not has_function_privilege('anon', 'public.create_crew(text)', 'execute'),
  'anon has no execute on create_crew'
);
select ok(
  not has_function_privilege('anon', 'public.add_crew_member(uuid, uuid)', 'execute'),
  'anon has no execute on add_crew_member'
);
select ok(
  not has_function_privilege('anon', 'private.accepted_quote_task_sources(uuid)', 'execute'),
  'anon has no execute on accepted_quote_task_sources'
);

select ok(
  has_function_privilege('authenticated', 'public.convert_accepted_quote(uuid, text, text, integer, date)', 'execute'),
  'authenticated can execute convert_accepted_quote'
);
select ok(
  has_function_privilege('authenticated', 'public.generate_agreement_visits(uuid, date)', 'execute'),
  'authenticated can execute generate_agreement_visits'
);
select ok(
  has_function_privilege('authenticated', 'public.assign_visit(uuid, uuid, date, integer)', 'execute'),
  'authenticated can execute assign_visit'
);
select ok(
  has_function_privilege('authenticated', 'public.reorder_route_visits(uuid, uuid[])', 'execute'),
  'authenticated can execute reorder_route_visits'
);
select ok(
  has_function_privilege('authenticated', 'public.publish_route(uuid)', 'execute'),
  'authenticated can execute publish_route'
);
select ok(
  has_function_privilege('authenticated', 'public.create_crew(text)', 'execute'),
  'authenticated can execute create_crew'
);
select ok(
  has_function_privilege('authenticated', 'public.add_crew_member(uuid, uuid)', 'execute'),
  'authenticated can execute add_crew_member'
);

select tests.authenticate_anon();
select throws_ok(
  $$ select public.convert_accepted_quote('00000000-0000-0000-0000-000000000001', 'one_time', null, null, '2026-10-09') $$,
  '42501',
  null,
  'anon cannot call convert_accepted_quote'
);

-- Fixtures -------------------------------------------------------------------
select tests.clear_auth();
select tests.create_user('rpc-owner@example.com', 'RPC Owner') as owner \gset
select tests.create_user('rpc-sales@example.com', 'RPC Sales') as sales \gset
select tests.create_user('rpc-dispatch@example.com', 'RPC Dispatch') as dispatcher \gset
select tests.create_user('rpc-crew@example.com', 'RPC Crew') as crew \gset
select tests.create_user('rpc-lead@example.com', 'RPC Lead') as lead \gset
select tests.create_user('rpc-read@example.com', 'RPC Read') as reader \gset
select tests.create_user('rpc-other@example.com', 'RPC Other') as other \gset

select tests.create_org('RPC One', 'rpc-one', :'owner'::uuid) as org \gset
select tests.create_org('RPC Two', 'rpc-two', :'other'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'reader'::uuid, 'read_only');

select (timezone('America/Chicago', now()))::date as today \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (:'org'::uuid, 'Pat Customer', '555-0100', 'pat@example.com', 'billing@example.com', '1 Bill St')
returning id as acct \gset

insert into public.contacts (org_id, account_id, first_name, last_name, email, phone, is_primary, is_billing)
values (:'org'::uuid, :'acct'::uuid, 'Pat', 'Customer', 'pat.contact@example.com', '555-0101', true, true);

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Main', 'Springfield', 'IL', '62704')
returning id as prop \gset

select public.quote_create(:'acct'::uuid, null, 'No property') as bare \gset
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Weekly mow') as qid \gset
select throws_ok(
  format($$ select public.convert_accepted_quote(%L, 'one_time', null, null, %L) $$, :'qid', :'today'),
  '22023',
  null,
  'a draft quote cannot be converted'
);

select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, notes_crew, sort)
values (:'org'::uuid, :'vid'::uuid, 'Mow', 'included', 0.25, 'sqft', 80, 1.5, 10, 'edge the walk', 0)
returning id as mow \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, option_group, option_tier, price, hours, cost, selected, sort
) values (
  :'org'::uuid, :'vid'::uuid, 'Season good', 'optional', 'program', 'good', 999, 9, 50, false, 1
) returning id as good \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, option_group, option_tier, price, hours, cost, selected, sort
) values (
  :'org'::uuid, :'vid'::uuid, 'Season better', 'optional', 'program', 'better', 20, 0, 8, true, 2
) returning id as better \gset
insert into public.quote_line_items (org_id, version_id, name, state, price, hours, cost, selected, sort)
values (:'org'::uuid, :'vid'::uuid, 'Aeration', 'optional', 5, 0.01, 1, true, 3)
returning id as extra \gset

select public.quote_send(:'qid'::uuid) as tok \gset
select tests.authenticate_anon();
select public.quote_accept(
  :'tok'::uuid,
  'Pat Buyer',
  'pat@example.com',
  true,
  'ua',
  null,
  array[:'better'::uuid, :'extra'::uuid]
) as accepted \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_send(:'bare'::uuid) as bare_tok \gset
select tests.authenticate_anon();
select public.quote_accept(:'bare_tok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua', null, null) as bare_accepted \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format($$ select public.convert_accepted_quote(%L, 'one_time', null, null, %L) $$, :'bare', :'today'),
  '22023',
  null,
  'an accepted quote without a property cannot be converted'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.convert_accepted_quote(%L, 'one_time', null, null, %L) $$, :'qid', :'today'),
  '42501',
  null,
  'crew cannot convert a quote'
);
select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format($$ select public.convert_accepted_quote(%L, 'one_time', null, null, %L) $$, :'qid', :'today'),
  '42501',
  null,
  'crew lead cannot convert a quote'
);
select throws_ok(
  $$ select public.create_crew('Lead crew') $$,
  '42501',
  null,
  'crew lead cannot create a crew'
);
select tests.authenticate_as(:'reader'::uuid, :'org'::uuid, 'read_only');
select throws_ok(
  format($$ select public.convert_accepted_quote(%L, 'one_time', null, null, %L) $$, :'qid', :'today'),
  '42501',
  null,
  'read_only cannot convert a quote'
);
select tests.authenticate_as(:'other'::uuid, :'org2'::uuid, 'owner');
select throws_ok(
  format($$ select public.convert_accepted_quote(%L, 'one_time', null, null, %L) $$, :'qid', :'today'),
  'P0002',
  null,
  'another org cannot convert the quote'
);

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select body ->> 'agreement_id' as agr, body ->> 'job_id' as job
from (select public.convert_accepted_quote(:'qid'::uuid, 'one_time', null, null, :'today'::date) as body) converted
\gset

select is(
  (select kind::text from public.agreements where id = :'agr'::uuid),
  'one_time',
  'conversion starts a one-time agreement'
);
select is(
  (select scheduled_date from public.visits where job_id = :'job'::uuid),
  null,
  'the converted visit stays unscheduled'
);
select is(
  (select route_id from public.visits where job_id = :'job'::uuid),
  null,
  'the converted visit has no route'
);
select is(
  (select occurrence_date from public.visits where job_id = :'job'::uuid),
  :'today'::date,
  'the occurrence date is the start date passed to convert'
);
select is(
  (select status::text from public.jobs where id = :'job'::uuid),
  'unscheduled',
  'the job stays unscheduled until a visit is assigned'
);
select is(
  (select crew_size from public.visits where job_id = :'job'::uuid),
  1,
  'the visit starts at crew size 1'
);
select is(
  (select budget_minutes from public.visits where job_id = :'job'::uuid),
  91,
  'budget minutes are round(sum of selected hours * 60 / crew_size)'
);
select is(
  (select count(*) from public.visit_tasks t join public.visits v on v.id = t.visit_id where v.job_id = :'job'::uuid),
  3::bigint,
  'included and customer-selected lines become tasks'
);
select is(
  (select is_extra from public.visit_tasks where source_line_item_id = :'mow'::uuid),
  false,
  'an included line is not an extra'
);
select is(
  (select is_extra from public.visit_tasks where source_line_item_id = :'extra'::uuid),
  false,
  'a chosen option is a normal task, not an extra'
);
select is(
  (select count(*) from public.visit_tasks where source_line_item_id = :'good'::uuid),
  0::bigint,
  'the unchosen option is not copied'
);
select is(
  (select quantity_text from public.visit_tasks where source_line_item_id = :'mow'::uuid),
  '0.25 sqft',
  'task quantity keeps the fraction and the unit'
);
select is(
  (select notes_crew from public.visit_tasks where source_line_item_id = :'mow'::uuid),
  'edge the walk',
  'crew notes from the quote line are copied onto the task'
);
select is(
  (select count(*) from public.visit_office_notes),
  0::bigint,
  'conversion does not copy customer contact into an office note'
);
select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('agreements', 'jobs', 'visits', 'visit_tasks', 'routes', 'crews')
      and column_name in ('price', 'cost', 'accepted_total', 'margin')
  ),
  0::bigint,
  'scheduling tables have no price or cost columns'
);
select results_eq(
  format(
    'select label from public.visit_tasks t join public.visits v on v.id = t.visit_id where v.job_id = %L::uuid order by t.sort',
    :'job'
  ),
  $$ values ('Mow'), ('Season better'), ('Aeration') $$,
  'tasks follow the selected lines and skip the unchosen option'
);

select is(
  (select public.convert_accepted_quote(:'qid'::uuid, 'one_time', null, null, :'today'::date) ->> 'agreement_id'),
  :'agr',
  'converting the same quote again returns the existing agreement'
);
select is(
  (select public.convert_accepted_quote(:'qid'::uuid, 'recurring', 'weekly', 1, :'today'::date) ->> 'job_id'),
  :'job',
  'a retry returns the existing job instead of raising 23505'
);
select throws_ok(
  format($$ select public.generate_agreement_visits(%L, %L) $$, :'agr', :'today'),
  '42501',
  null,
  'sales cannot generate visits'
);
select throws_ok(
  $$ select public.create_crew('Sales crew') $$,
  '42501',
  null,
  'sales cannot create a crew'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.create_crew('North') as crew_id \gset
select lives_ok(
  format($$ select public.add_crew_member(%L, %L) $$, :'crew_id', :'crew'),
  'dispatcher can add a crew member'
);
select throws_ok(
  format($$ select public.add_crew_member(%L, %L) $$, :'crew_id', :'sales'),
  '23503',
  null,
  'a sales user is not a field member'
);
select throws_ok(
  format($$ select public.set_crew_lead(%L, %L) $$, :'crew_id', :'crew'),
  '23514',
  null,
  'a crew member who is not a lead cannot be the default lead'
);
select lives_ok(
  format($$ select public.set_crew_lead(%L, %L) $$, :'crew_id', :'lead'),
  'dispatcher can set the crew lead'
);
select is(
  (select default_lead_id from public.crews where id = :'crew_id'::uuid),
  :'lead'::uuid,
  'the default lead is the crew lead'
);
select public.create_crew('South') as crew_south \gset
select throws_ok(
  format($$ select public.set_crew_lead(%L, %L) $$, :'crew_south', :'lead'),
  '23505',
  null,
  'a person can belong to one crew'
);
select throws_ok(
  $$ select public.create_crew('   ') $$,
  '22023',
  null,
  'a blank crew name is rejected'
);

select id as visit from public.visits where job_id = :'job'::uuid \gset
select tests.clear_auth();
insert into public.agreements (org_id, account_id, property_id, kind, start_date)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'one_time', :'today'::date)
returning id as agr_b \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_b'::uuid, :'prop'::uuid, 'Side job')
returning id as job_b \gset
insert into public.visits (org_id, agreement_id, job_id, property_id, occurrence_date, scheduled_date)
values (:'org'::uuid, :'agr_b'::uuid, :'job_b'::uuid, :'prop'::uuid, :'today'::date, :'today'::date)
returning id as visit_b \gset
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');

select public.assign_visit(:'visit'::uuid, :'crew_id'::uuid, :'today'::date) as route \gset
select is(
  (select sort from public.visits where id = :'visit'::uuid),
  0,
  'the server appends the first visit at sort 0'
);
select is(
  (select occurrence_date from public.visits where id = :'visit'::uuid),
  :'today'::date,
  'assign does not change the occurrence date'
);
select is(
  (select scheduled_date from public.visits where id = :'visit'::uuid),
  :'today'::date,
  'assign sets the scheduled date'
);
select is(
  (select status::text from public.routes where id = :'route'::uuid),
  'draft',
  'the first assignment creates a draft route'
);
select is(
  public.assign_visit(:'visit_b'::uuid, :'crew_id'::uuid, :'today'::date),
  :'route'::uuid,
  'a second visit on the same day reuses the crew route'
);
select throws_ok(
  format($$ select public.reorder_route_visits(%L, array[%L]::uuid[]) $$, :'route', :'visit'),
  '22023',
  null,
  'reorder requires every visit on the route'
);
select public.reorder_route_visits(:'route'::uuid, array[:'visit_b'::uuid, :'visit'::uuid]);
select is(
  (select sort from public.visits where id = :'visit_b'::uuid),
  0,
  'reorder puts the first id at sort 0'
);
select is(
  (select sort from public.visits where id = :'visit'::uuid),
  1,
  'reorder puts the second id at sort 1'
);
select public.publish_route(:'route'::uuid) as published_at \gset
select public.publish_route(:'route'::uuid) as published_again \gset
select is(
  :'published_at'::timestamptz,
  :'published_again'::timestamptz,
  'publishing again keeps the original timestamp'
);
select is(
  (select status::text from public.routes where id = :'route'::uuid),
  'published',
  'publish marks the route published'
);
select is((select revision from public.routes where id = :'route'::uuid), 0, 'publishing does not bump the route revision');
select public.reorder_route_visits(:'route'::uuid, array[:'visit'::uuid, :'visit_b'::uuid]);
select is((select revision from public.routes where id = :'route'::uuid), 2, 'reordering a published route bumps its revision');

select tests.clear_auth();
update public.routes set status = 'in_progress' where id = :'route'::uuid;
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format($$ select public.reorder_route_visits(%L, array[%L, %L]::uuid[]) $$, :'route', :'visit', :'visit_b'),
  '22023',
  null,
  'an in-progress route cannot be reordered'
);
select tests.clear_auth();
update public.routes set status = 'done' where id = :'route'::uuid;
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format($$ select public.assign_visit(%L, %L, %L) $$, :'visit', :'crew_id', :'today'),
  '22023',
  null,
  'a done route cannot take another assignment'
);
select tests.clear_auth();
update public.routes set status = 'published' where id = :'route'::uuid;
update public.visits set status = 'cancelled' where id = :'visit_b'::uuid;
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format($$ select public.assign_visit(%L, %L, %L) $$, :'visit_b', :'crew_id', (:'today'::date + 1)),
  '22023',
  null,
  'a cancelled visit cannot be moved'
);

select throws_ok(
  format($$ select public.generate_agreement_visits(%L, %L) $$, :'agr', :'today'),
  '22023',
  null,
  'a one-time agreement does not generate visits'
);

select tests.clear_auth();
update public.agreements
set kind = 'recurring', frequency = 'weekly'
where id = :'agr'::uuid;
insert into public.visit_tasks (org_id, visit_id, label, is_extra, sort)
values (:'org'::uuid, :'visit'::uuid, 'One-time add-on', true, 9);
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.generate_agreement_visits(:'agr'::uuid, (:'today'::date + 21)) as created \gset
select public.generate_agreement_visits(:'agr'::uuid, (:'today'::date + 21)) as created_again \gset
select is(:'created'::integer, 3, 'weekly generation adds the dates after the start visit');
select is(:'created_again'::integer, 0, 'generating the same horizon again creates nothing');
select results_eq(
  format(
    'select occurrence_date from public.visits where agreement_id = %L::uuid order by occurrence_date',
    :'agr'
  ),
  format(
    'values (%L::date), (%L::date + 7), (%L::date + 14), (%L::date + 21)',
    :'today', :'today', :'today', :'today'
  ),
  'weekly dates land on the occurrence, including a visit already assigned'
);
select is(
  (
    select count(*)
    from public.visit_tasks t
    join public.visits v on v.id = t.visit_id
    where v.agreement_id = :'agr'::uuid
      and v.id <> :'visit'::uuid
      and t.is_extra
  ),
  0::bigint,
  'a one-time add-on is not copied onto later visits'
);
select tests.clear_auth();
update public.visits
set status = 'cancelled'
where agreement_id = :'agr'::uuid
  and occurrence_date = :'today'::date + 7;
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select is(
  public.generate_agreement_visits(:'agr'::uuid, (:'today'::date + 21)),
  0,
  'a cancelled occurrence is not recreated'
);
select is(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr'::uuid
      and occurrence_date = :'today'::date + 7
  ),
  1::bigint,
  'the cancelled occurrence still occupies its date'
);

select tests.clear_auth();
select ((date_trunc('month', :'today'::date) + interval '3 months')::date + 30) as month_start \gset
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'monthly', :'month_start'::date, 'active'
) returning id as agr_month \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_month'::uuid, :'prop'::uuid, 'Monthly')
returning id as job_month \gset
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select is(
  public.generate_agreement_visits(:'agr_month'::uuid, (:'month_start'::date + interval '3 months')::date),
  4,
  'monthly generation creates one visit per month'
);
select is(
  public.generate_agreement_visits(:'agr_month'::uuid, (:'month_start'::date + interval '3 months')::date),
  0,
  'monthly generation is idempotent'
);
select results_eq(
  format(
    'select occurrence_date from public.visits where agreement_id = %L::uuid order by occurrence_date',
    :'agr_month'
  ),
  format(
    $$ values (%L::date), ((%L::date + interval '1 month')::date), ((%L::date + interval '2 months')::date), ((%L::date + interval '3 months')::date) $$,
    :'month_start', :'month_start', :'month_start', :'month_start'
  ),
  'monthly visits keep the calendar day and clamp short months'
);

select tests.clear_auth();
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, start_date, end_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly',
  :'today'::date + 40, :'today'::date + 54, 'active'
) returning id as agr_end \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_end'::uuid, :'prop'::uuid, 'Ends')
returning id as job_end \gset
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', :'today'::date - 14, 'active'
) returning id as agr_past \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_past'::uuid, :'prop'::uuid, 'Past')
returning id as job_past \gset
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', :'today'::date, 'active'
) returning id as agr_horizon \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_horizon'::uuid, :'prop'::uuid, 'Horizon')
returning id as job_horizon \gset
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select is(
  public.generate_agreement_visits(:'agr_end'::uuid, :'today'::date + 400),
  3,
  'generation stops at the agreement end date'
);
select is(
  (select count(*) from public.visits where agreement_id = :'agr_past'::uuid),
  0::bigint,
  'a past start has no visits before generation'
);
select public.generate_agreement_visits(:'agr_past'::uuid, :'today'::date + 7);
select is(
  (select min(occurrence_date) from public.visits where agreement_id = :'agr_past'::uuid),
  :'today'::date,
  'generation starts at today when the agreement start is in the past'
);
select public.generate_agreement_visits(:'agr_horizon'::uuid, :'today'::date + 800);
select ok(
  (select max(occurrence_date) from public.visits where agreement_id = :'agr_horizon'::uuid) <= :'today'::date + 366,
  'generation does not schedule more than about a year out'
);

select tests.clear_auth();
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Unassigned')
returning id as job_open \gset

update public.agreements set status = 'paused' where id = :'agr_month'::uuid;
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  format($$ select public.generate_agreement_visits(%L, %L) $$, :'agr_month', :'today'),
  '22023',
  null,
  'a paused agreement does not generate visits'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.assign_visit(%L, %L, %L) $$, :'visit', :'crew_id', :'today'),
  '42501',
  null,
  'crew cannot assign a visit'
);
select throws_ok(
  format($$ select public.reorder_route_visits(%L, array[%L]::uuid[]) $$, :'route', :'visit'),
  '42501',
  null,
  'crew cannot reorder a route'
);
select throws_ok(
  format($$ select public.publish_route(%L) $$, :'route'),
  '42501',
  null,
  'crew cannot publish a route'
);
select throws_ok(
  $$ select public.create_crew('Crew crew') $$,
  '42501',
  null,
  'crew cannot create a crew'
);
select throws_ok(
  format($$ select public.add_crew_member(%L, %L) $$, :'crew_id', :'crew'),
  '42501',
  null,
  'crew cannot add a crew member'
);
select throws_ok(
  format(
    $$ insert into public.agreements (org_id, account_id, property_id, kind, start_date) values (%L, %L, %L, 'one_time', %L) $$,
    :'org', :'acct', :'prop', :'today'
  ),
  '42501',
  null,
  'crew cannot insert agreements'
);
select throws_ok(
  format($$ insert into public.jobs (org_id, property_id, title) values (%L, %L, 'Crew job') $$, :'org', :'prop'),
  '42501',
  null,
  'crew cannot insert jobs'
);
select throws_ok(
  format(
    $$ insert into public.routes (org_id, crew_id, date) values (%L, %L, %L) $$,
    :'org', :'crew_id', :'today'
  ),
  '42501',
  null,
  'crew cannot insert routes'
);
select throws_ok(
  format(
    $$ insert into public.visits (org_id, job_id, property_id, occurrence_date, scheduled_date) values (%L, %L, %L, %L, %L) $$,
    :'org', :'job_open', :'prop', :'today', :'today'
  ),
  '42501',
  null,
  'crew cannot insert visits'
);
select throws_ok(
  format($$ update public.routes set status = 'done' where id = %L $$, :'route'),
  '42501',
  null,
  'crew cannot update route status'
);
update public.jobs set title = 'crew' where id = :'job'::uuid;
update public.agreements set notes_office = 'crew' where id = :'agr'::uuid;
delete from public.visits where id = :'visit'::uuid;
delete from public.jobs where id = :'job'::uuid;
delete from public.routes where id = :'route'::uuid;
delete from public.agreements where id = :'agr'::uuid;

select is((select phone from public.accounts), null, 'crew cannot select customer phone');
select is((select email from public.accounts), null, 'crew cannot select customer email');
select is((select billing_email from public.accounts), null, 'crew cannot select billing email');
select is((select billing_address_line1 from public.accounts), null, 'crew cannot select billing address');
select is((select first_name from public.contacts), null, 'crew cannot select contact first name');
select is((select last_name from public.contacts), null, 'crew cannot select contact last name');
select is(
  (select a.phone
     from public.visits v
     join public.properties p on p.id = v.property_id
     left join public.accounts a on a.id = p.account_id
    where v.id = :'visit'::uuid),
  null,
  'crew cannot read customer phone by joining a visit to the account'
);
select is(
  (select public.my_crews() -> 0 ->> 'id'),
  :'crew_id',
  'a member can read their own crew'
);
select ok(
  public.my_crews()::text not like '%email%'
    and public.my_crews()::text not like '%phone%',
  'my_crews returns no phone or email'
);

select tests.clear_auth();
select is((select title from public.jobs where id = :'job'::uuid), 'Weekly mow', 'crew cannot update jobs');
select is((select status::text from public.routes where id = :'route'::uuid), 'published', 'crew cannot update routes');
select is((select notes_office from public.agreements where id = :'agr'::uuid), null, 'crew cannot update agreements');
select is((select count(*) from public.visits where id = :'visit'::uuid), 1::bigint, 'crew cannot delete visits');
select is((select count(*) from public.visit_office_notes), 0::bigint, 'there is no office note on the converted visit');
select is((select count(*) from public.jobs where id = :'job'::uuid), 1::bigint, 'crew cannot delete jobs');
select is((select count(*) from public.routes where id = :'route'::uuid), 1::bigint, 'crew cannot delete routes');
select is((select count(*) from public.agreements where id = :'agr'::uuid), 1::bigint, 'crew cannot delete agreements');

select * from finish();
