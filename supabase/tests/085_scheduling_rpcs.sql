-- Scheduling RPCs: convert, generate, assign, reorder, publish, crews.
-- Quote price and cost denial stays in the privilege-gaps tests.

select plan(161);

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
  not has_function_privilege('anon', 'public.cancel_visit(uuid, text)', 'execute'),
  'anon has no execute on cancel_visit'
);
select ok(
  not has_function_privilege('anon', 'public.skip_visit(uuid, text)', 'execute'),
  'anon has no execute on skip_visit'
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
select ok(
  has_function_privilege('authenticated', 'public.cancel_visit(uuid, text)', 'execute'),
  'authenticated can execute cancel_visit'
);
select ok(
  has_function_privilege('authenticated', 'public.skip_visit(uuid, text)', 'execute'),
  'authenticated can execute skip_visit'
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
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'visit_tasks'
      and column_name = 'is_extra'
  ),
  0::bigint,
  'visit tasks have no is_extra column'
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
select throws_ok(
  format($$ select public.convert_accepted_quote(%L, 'recurring', 'weekly', 1, %L) $$, :'qid', :'today'),
  '22023',
  null,
  'a retry with a different schedule raises'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Recurring mow') as qid_r \gset
select public.quote_current_version(:'qid_r'::uuid) as vid_r \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort)
values (:'org'::uuid, :'vid_r'::uuid, 'Mow', 'included', 1, 'visit', 40, 1, 5, 0);
select public.quote_send(:'qid_r'::uuid) as tok_r \gset
select tests.authenticate_anon();
select public.quote_accept(:'tok_r'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua', null, null) as accepted_r \gset
select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select ((extract(dow from :'today'::date)::integer + 1) % 7) as next_dow \gset
select body ->> 'agreement_id' as agr_r
from (
  select public.convert_accepted_quote(
    :'qid_r'::uuid, 'recurring', 'weekly', :'next_dow'::integer, :'today'::date
  ) as body
) converted \gset
select is(
  (select count(*) from public.visits where agreement_id = :'agr_r'::uuid and occurrence_date = :'today'::date),
  0::bigint,
  'recurring conversion does not leave a visit on the start date'
);
select is(
  (select min(occurrence_date) from public.visits where agreement_id = :'agr_r'::uuid),
  (:'today'::date + 1),
  'recurring conversion starts on the preferred weekday'
);
select is(
  (
    select scheduled_date
    from public.visits
    where agreement_id = :'agr_r'::uuid
    order by occurrence_date
    limit 1
  ),
  (:'today'::date + 1),
  'generated visits are dated on their occurrence'
);
select ok(
  (
    select count(*)
    from public.visit_tasks t
    join public.visits v on v.id = t.visit_id
    where v.agreement_id = :'agr_r'::uuid
  ) > 0,
  'recurring conversion copies tasks onto the series'
);

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
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
select lives_ok(
  format($$ select public.skip_visit(%L, 'weather') $$, :'visit_b'),
  'dispatcher can skip a stop'
);
select lives_ok(
  format($$ select public.reorder_route_visits(%L, array[%L]::uuid[]) $$, :'route', :'visit'),
  'a skipped stop does not block reorder'
);
select throws_ok(
  format($$ select public.reorder_route_visits(%L, array[%L, %L]::uuid[]) $$, :'route', :'visit', :'visit_b'),
  '22023',
  null,
  'a skipped stop is not part of the reorder list'
);

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
update public.visits set status = 'cancelled', skip_reason = null where id = :'visit_b'::uuid;
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
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select id as visit_next
from public.visits
where agreement_id = :'agr'::uuid
  and occurrence_date = :'today'::date + 7
\gset
select lives_ok(
  format($$ select public.cancel_visit(%L, 'customer called') $$, :'visit_next'),
  'cancelling a visit keeps the occurrence'
);
select is(
  (select status::text from public.visits where id = :'visit_next'::uuid),
  'cancelled',
  'cancel marks the visit cancelled'
);
select is(
  (select note from public.visit_office_notes where visit_id = :'visit_next'::uuid),
  'customer called',
  'the cancel reason is an office note'
);
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
select id as visit_noted
from public.visits
where agreement_id = :'agr'::uuid
  and occurrence_date = :'today'::date + 14
\gset
insert into public.visit_office_notes (visit_id, org_id, note)
values (:'visit_noted'::uuid, :'org'::uuid, 'gate code is 1234');
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format($$ select public.cancel_visit(%L, 'rain date') $$, :'visit_noted'),
  'cancelling appends the reason to an existing office note'
);
select is(
  (select note from public.visit_office_notes where visit_id = :'visit_noted'::uuid),
  E'gate code is 1234\nrain date',
  'the new cancel reason follows the existing office note'
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
update public.memberships
set status = 'disabled'
where user_id = :'crew'::uuid
  and org_id = :'org'::uuid;
select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is(public.my_crews(), '[]'::jsonb, 'a disabled membership sees no crews');
select tests.clear_auth();
update public.memberships
set status = 'active'
where user_id = :'crew'::uuid
  and org_id = :'org'::uuid;

select tests.clear_auth();
select is((select title from public.jobs where id = :'job'::uuid), 'Weekly mow', 'crew cannot update jobs');
select is((select status::text from public.routes where id = :'route'::uuid), 'published', 'crew cannot update routes');
select is((select notes_office from public.agreements where id = :'agr'::uuid), null, 'crew cannot update agreements');
select is((select count(*) from public.visits where id = :'visit'::uuid), 1::bigint, 'crew cannot delete visits');
select is((select count(*) from public.visit_office_notes where visit_id = :'visit'::uuid), 0::bigint, 'there is no office note on the converted visit');
select is((select count(*) from public.jobs where id = :'job'::uuid), 1::bigint, 'crew cannot delete jobs');
select is((select count(*) from public.routes where id = :'route'::uuid), 1::bigint, 'crew cannot delete routes');
select is((select count(*) from public.agreements where id = :'agr'::uuid), 1::bigint, 'crew cannot delete agreements');

select ok(
  not has_function_privilege('anon', 'public.update_agreement_schedule(uuid, text, text, integer, date)', 'execute'),
  'anon has no execute on update_agreement_schedule'
);
select ok(
  has_function_privilege('authenticated', 'public.update_agreement_schedule(uuid, text, text, integer, date)', 'execute'),
  'authenticated can execute update_agreement_schedule'
);

select tests.clear_auth();
insert into public.agreements (org_id, account_id, property_id, kind, start_date, status)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'one_time', :'today'::date, 'active')
returning id as agr_sched \gset

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select throws_ok(
  format($$ update public.agreements set kind = 'recurring', frequency = 'weekly' where id = %L $$, :'agr_sched'),
  '42501',
  null,
  'sales cannot write agreement schedule columns directly'
);
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'weekly', 1, %L) $$,
    :'agr_sched', :'today'
  ),
  'sales can save a recurring schedule'
);
select is((select kind::text from public.agreements where id = :'agr_sched'::uuid), 'recurring', 'sales saved the agreement kind');
select is((select frequency::text from public.agreements where id = :'agr_sched'::uuid), 'weekly', 'sales saved the frequency');
select is((select preferred_dow from public.agreements where id = :'agr_sched'::uuid), 1::smallint, 'sales saved the preferred day');
select is((select start_date from public.agreements where id = :'agr_sched'::uuid), :'today'::date, 'sales saved the start date');
select lives_ok(
  format($$ select public.update_agreement_schedule(%L, 'one_time', null, null, %L) $$, :'agr_sched', :'today'),
  'sales can save a one-time schedule'
);
select is((select frequency from public.agreements where id = :'agr_sched'::uuid), null, 'one-time clears the frequency');
select is((select preferred_dow from public.agreements where id = :'agr_sched'::uuid), null, 'one-time clears the preferred day');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'biweekly', 2, %L) $$,
    :'agr_sched', :'today'
  ),
  'the owner can save the schedule'
);
select tests.clear_auth();
select tests.create_user('rpc-admin@example.com', 'RPC Admin') as sched_admin \gset
select tests.add_member(:'org'::uuid, :'sched_admin'::uuid, 'admin');
select tests.authenticate_as(:'sched_admin'::uuid, :'org'::uuid, 'admin');
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'weekly', 4, %L) $$,
    :'agr_sched', :'today'
  ),
  'an admin can save the schedule'
);
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'monthly', 3, %L) $$,
    :'agr_sched', :'today'
  ),
  'a dispatcher can save the schedule'
);
select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'weekly', 1, %L) $$,
    :'agr_sched', :'today'
  ),
  '42501',
  null,
  'crew cannot save an agreement schedule'
);

select tests.clear_auth();
update public.agreements set status = 'ended' where id = :'agr_sched'::uuid;
select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select throws_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'one_time', null, null, %L) $$,
    :'agr_sched', :'today'
  ),
  '22023',
  null,
  'an ended agreement cannot be rescheduled'
);
select tests.clear_auth();
update public.agreements
set status = 'active', end_date = :'today'::date
where id = :'agr_sched'::uuid;
select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select throws_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'one_time', null, null, %L) $$,
    :'agr_sched', (:'today'::date + 1)
  ),
  '22023',
  null,
  'the start date cannot be after the agreement ends'
);

select tests.clear_auth();
select extract(dow from :'today'::date)::integer as dow_today \gset
select ((:dow_today + 2) % 7) as dow_other \gset
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', :dow_today, :'today'::date, 'active'
) returning id as agr_shift \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_shift'::uuid, :'prop'::uuid, 'Shift')
returning id as job_shift \gset
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.generate_agreement_visits(:'agr_shift'::uuid, (:'today'::date + 21)) as shift_created \gset
select id as visit_keep
from public.visits
where agreement_id = :'agr_shift'::uuid
  and occurrence_date = :'today'::date + 7
\gset
select public.assign_visit(:'visit_keep'::uuid, :'crew_id'::uuid, :'today'::date) as shift_route \gset
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'biweekly', %s, %L) $$,
    :'agr_shift', :dow_today, :'today'
  ),
  'changing the frequency cancels visits that no longer match'
);
select is(
  (
    select status::text
    from public.visits
    where agreement_id = :'agr_shift'::uuid
      and occurrence_date = :'today'::date + 21
  ),
  'cancelled',
  'a future unassigned visit off the new frequency is cancelled'
);
select is(
  (
    select note
    from public.visit_office_notes n
    join public.visits v on v.id = n.visit_id
    where v.agreement_id = :'agr_shift'::uuid
      and v.occurrence_date = :'today'::date + 21
  ),
  'schedule_changed',
  'a schedule change records schedule_changed'
);
select is(
  (
    select status::text
    from public.visits
    where agreement_id = :'agr_shift'::uuid
      and occurrence_date = :'today'::date + 14
  ),
  'scheduled',
  'a visit that still matches the new frequency stays scheduled'
);
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'weekly', %s, %L) $$,
    :'agr_shift', :dow_other, :'today'
  ),
  'changing the preferred day replaces the unassigned series'
);
select is(
  (select status::text from public.visits where id = :'visit_keep'::uuid),
  'scheduled',
  'an assigned visit stays when the preferred day changes'
);
select is(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr_shift'::uuid
      and route_id is null
      and status = 'scheduled'
      and occurrence_date >= :'today'::date
      and extract(dow from occurrence_date)::integer = :dow_today
  ),
  0::bigint,
  'future unassigned visits on the old day are no longer scheduled'
);
select is(
  (
    select note
    from public.visit_office_notes n
    join public.visits v on v.id = n.visit_id
    where v.id = (
      select id
      from public.visits
      where agreement_id = :'agr_shift'::uuid
        and occurrence_date = :'today'::date + 14
    )
  ),
  'schedule_changed',
  'the old preferred day is cancelled with schedule_changed'
);
select ok(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr_shift'::uuid
      and route_id is null
      and status = 'scheduled'
      and extract(dow from occurrence_date)::integer = :dow_other
  ) > 0,
  'the new preferred day has scheduled visits'
);
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'one_time', null, null, %L) $$,
    :'agr_shift', :'today'
  ),
  'switching to one-time cancels the future unassigned series'
);
select is(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr_shift'::uuid
      and route_id is null
      and status = 'scheduled'
      and occurrence_date >= :'today'::date
  ),
  0::bigint,
  'one-time does not leave future unassigned visits scheduled'
);
select is(
  (select status::text from public.visits where id = :'visit_keep'::uuid),
  'scheduled',
  'an assigned visit stays when the agreement becomes one-time'
);

select tests.clear_auth();
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', :dow_today, :'today'::date, 'active'
) returning id as agr_back \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_back'::uuid, :'prop'::uuid, 'Round trip')
returning id as job_back \gset
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.generate_agreement_visits(:'agr_back'::uuid, (:'today'::date + 21)) as back_created \gset
select id as visit_customer
from public.visits
where agreement_id = :'agr_back'::uuid
  and occurrence_date = :'today'::date + 21
\gset
select public.cancel_visit(:'visit_customer'::uuid, 'customer called');
select id as visit_held
from public.visits
where agreement_id = :'agr_back'::uuid
  and occurrence_date = :'today'::date + 7
\gset
select public.assign_visit(:'visit_held'::uuid, :'crew_id'::uuid, :'today'::date) as back_route \gset
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'weekly', %s, %L) $$,
    :'agr_back', :dow_other, :'today'
  ),
  'the preferred day can move off the original weekday'
);
select is(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr_back'::uuid
      and status = 'scheduled'
      and occurrence_date is distinct from :'today'::date + 7
      and date_trunc('week', occurrence_date::timestamp) = date_trunc('week', (:'today'::date + 7)::timestamp)
  ),
  0::bigint,
  'a week that already has an assigned visit does not get a second visit'
);
select ok(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr_back'::uuid
      and route_id is null
      and status = 'scheduled'
      and extract(dow from occurrence_date)::integer = :dow_other
  ) > 0,
  'weeks without an active visit are generated on the new day'
);
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'weekly', %s, %L) $$,
    :'agr_back', :dow_today, :'today'
  ),
  'changing the preferred day back reopens the cancelled series'
);
select is(
  (
    select status::text
    from public.visits
    where agreement_id = :'agr_back'::uuid
      and occurrence_date = :'today'::date + 14
  ),
  'scheduled',
  'a visit cancelled for the schedule change is open again'
);
select is(
  (select status::text from public.visits where id = :'visit_customer'::uuid),
  'cancelled',
  'a visit cancelled by the office stays cancelled'
);

select tests.clear_auth();
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', :dow_today, :'today'::date, 'active'
) returning id as agr_start \gset
insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr_start'::uuid, :'prop'::uuid, 'Start move')
returning id as job_start \gset
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.generate_agreement_visits(:'agr_start'::uuid, (:'today'::date + 14)) as start_created \gset
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'weekly', %s, %L) $$,
    :'agr_start', :dow_today, (:'today'::date + 7)
  ),
  'a start-date change is a schedule change'
);
select is(
  (
    select status::text
    from public.visits
    where agreement_id = :'agr_start'::uuid
      and occurrence_date = :'today'::date
  ),
  'cancelled',
  'moving the start date cancels the visit before the new start'
);
select is(
  (
    select note
    from public.visit_office_notes n
    join public.visits v on v.id = n.visit_id
    where v.agreement_id = :'agr_start'::uuid
      and v.occurrence_date = :'today'::date
  ),
  'schedule_changed',
  'a start-date change records schedule_changed'
);
select is(
  (
    select status::text
    from public.visits
    where agreement_id = :'agr_start'::uuid
      and occurrence_date = :'today'::date + 7
  ),
  'scheduled',
  'a visit on the new start date stays scheduled'
);

select * from finish();
