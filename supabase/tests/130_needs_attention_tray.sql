-- S06 Needs attention tray: bucket queries, overdue stays put, sales → unassigned.

select plan(16);

select ok(
  not has_function_privilege('anon', 'public.office_attention_tray(date)', 'execute'),
  'anon has no execute on office_attention_tray'
);
select ok(
  has_function_privilege('authenticated', 'public.office_attention_tray(date)', 'execute'),
  'authenticated can execute office_attention_tray'
);

select tests.create_user('tray-owner@example.com', 'Tray Owner') as owner \gset
select tests.create_user('tray-sales@example.com', 'Tray Sales') as sales \gset
select tests.create_user('tray-dispatch@example.com', 'Tray Dispatch') as dispatcher \gset
select tests.create_user('tray-crew@example.com', 'Tray Crew') as crew \gset
select tests.create_org('Tray Co', 'tray-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;
select private.org_local_today(:'org'::uuid) as today \gset
select (:'today'::date - 2) as overdue_day \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (:'org'::uuid, 'Tray Account', '555-0100', 'tray@example.com', 'bill@example.com', '1 Bill St')
returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '10 Tray St', 'Springfield', 'IL', '62701')
returning id as prop \gset
select tests.clear_auth();

insert into public.jobs (org_id, property_id, title, status) values
  (:'org'::uuid, :'prop'::uuid, 'Unassigned stop', 'unscheduled') returning id as job_unassigned \gset
insert into public.jobs (org_id, property_id, title, status) values
  (:'org'::uuid, :'prop'::uuid, 'Overdue stop', 'scheduled') returning id as job_overdue \gset
insert into public.jobs (org_id, property_id, title, status) values
  (:'org'::uuid, :'prop'::uuid, 'Reschedule stop', 'scheduled') returning id as job_reschedule \gset
insert into public.jobs (org_id, property_id, title, status) values
  (:'org'::uuid, :'prop'::uuid, 'Flagged stop', 'scheduled') returning id as job_flag \gset

insert into public.visits (org_id, job_id, property_id, sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes)
values (:'org'::uuid, :'job_unassigned'::uuid, :'prop'::uuid, 0, :'today'::date, null, 'scheduled', 1, 30)
returning id as visit_unassigned \gset
insert into public.visits (org_id, job_id, property_id, sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes)
values (:'org'::uuid, :'job_overdue'::uuid, :'prop'::uuid, 0, :'overdue_day'::date, :'overdue_day'::date, 'scheduled', 1, 30)
returning id as visit_overdue \gset
insert into public.visits (org_id, job_id, property_id, sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes, skip_reason)
values (:'org'::uuid, :'job_reschedule'::uuid, :'prop'::uuid, 0, :'today'::date, :'today'::date, 'skipped', 1, 30, 'weather')
returning id as visit_reschedule \gset
insert into public.visits (org_id, job_id, property_id, sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes)
values (:'org'::uuid, :'job_flag'::uuid, :'prop'::uuid, 0, :'today'::date, :'today'::date, 'scheduled', 1, 30)
returning id as visit_flag \gset
insert into public.enhancement_requests (org_id, visit_id, property_id, tag, note, status, client_id)
values (:'org'::uuid, :'visit_flag'::uuid, :'prop'::uuid, 'mulch', 'beds need refresh', 'new', gen_random_uuid());

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select is((public.office_attention_tray(:'today'::date) -> 'counts' ->> 'unassigned')::int, 1,
  'unassigned bucket counts undated visits without a route');
select is((public.office_attention_tray(:'today'::date) -> 'counts' ->> 'overdue')::int, 1,
  'overdue bucket counts open visits before as_of');
select is((public.office_attention_tray(:'today'::date) -> 'counts' ->> 'needs_reschedule')::int, 1,
  'needs_reschedule bucket counts skipped visits');
select is((public.office_attention_tray(:'today'::date) -> 'counts' ->> 'flags')::int, 1,
  'flags bucket counts visits with a new enhancement request');
select ok(exists (
  select 1 from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'unassigned') i
  where i ->> 'id' = :'visit_unassigned'), 'unassigned bucket lists the undated visit');
select ok(exists (
  select 1 from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'overdue') i
  where i ->> 'id' = :'visit_overdue'), 'overdue bucket lists the past-dated visit');
select ok(exists (
  select 1 from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'needs_reschedule') i
  where i ->> 'id' = :'visit_reschedule'), 'needs_reschedule bucket lists the skipped visit');
select ok(exists (
  select 1 from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'flags') i
  where i ->> 'id' = :'visit_flag'), 'flags bucket lists the enhancement visit');

select tests.clear_auth();
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly',
  extract(dow from :'today'::date)::integer, :'today'::date - 14, 'active'
) returning id as agr_roll \gset
insert into public.jobs (org_id, agreement_id, property_id, title, status)
values (:'org'::uuid, :'agr_roll'::uuid, :'prop'::uuid, 'Roll guard', 'scheduled')
returning id as job_roll \gset
update public.visits
set agreement_id = :'agr_roll'::uuid, job_id = :'job_roll'::uuid
where id = :'visit_overdue'::uuid;

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.generate_agreement_visits(:'agr_roll'::uuid, :'today'::date + 56) as filled \gset
select is((select scheduled_date from public.visits where id = :'visit_overdue'::uuid), :'overdue_day'::date,
  'overdue visit keeps its scheduled_date after horizon fill');
select is((select occurrence_date from public.visits where id = :'visit_overdue'::uuid), :'overdue_day'::date,
  'overdue visit keeps its occurrence_date after horizon fill');
select is((public.office_attention_tray(:'today'::date) -> 'counts' ->> 'overdue')::int, 1,
  'overdue visit remains in the overdue bucket after fill');

select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Sales convert') as qid_sales \gset
select public.quote_current_version(:'qid_sales'::uuid) as vid_sales \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort)
values (:'org'::uuid, :'vid_sales'::uuid, 'Mow', 'included', 1, 'visit', 40, 0.5, 10, 0);
select public.quote_send(:'qid_sales'::uuid) as tok_sales \gset
select tests.authenticate_anon();
select public.quote_accept(:'tok_sales'::uuid, 'Sales Buyer', 'buyer@example.com', true, 'ua', null, null) as accepted_sales \gset
select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select body ->> 'job_id' as job_sales
from (select public.convert_accepted_quote(:'qid_sales'::uuid, 'one_time', null, null, :'today'::date) as body) c
\gset
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select ok(exists (
  select 1
  from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'unassigned') item
  join public.visits v on v.id = (item ->> 'id')::uuid
  where v.job_id = :'job_sales'::uuid
), 'a sales-converted visit lands in the unassigned bucket');
select is((
  select route_id is null and scheduled_date is null from public.visits where job_id = :'job_sales'::uuid
), true, 'sales-converted visit has no route and no scheduled_date');

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(format($$ select public.office_attention_tray(%L) $$, :'today'), '42501', null,
  'crew cannot read the attention tray');

select * from finish();
