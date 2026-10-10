-- S05: seasonal one-time window + warn date; scheduling clears warning.

select plan(8);

select has_column('public', 'services', 'window_start', 'services.window_start exists');
select has_column('public', 'services', 'warn_date', 'services.warn_date exists');
select has_column('public', 'jobs', 'service_id', 'jobs.service_id links the catalog service');

select tests.create_user('s05-owner@example.com', 'S05 Owner') as owner \gset
select tests.create_user('s05-dispatch@example.com', 'S05 Dispatch') as dispatcher \gset
select tests.create_org('S05 Co', 's05-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;
select private.org_local_today(:'org'::uuid) as today \gset
select (:'today'::date - 5) as warn_day \gset
select (:'today'::date - 30) as window_start \gset
select (:'today'::date + 30) as window_end \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (:'org'::uuid, 'S05 Account', '555-0505', 's05@example.com', 'bill@example.com', '5 Bill St')
returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '85 Aeration Ave', 'Springfield', 'IL', '62701')
returning id as prop \gset
insert into public.services (org_id, name, slug, kind, window_start, window_end, warn_date)
values (
  :'org'::uuid, 'Fall aeration', 'fall-aeration', 'cleanup',
  :'window_start'::date, :'window_end'::date, :'warn_day'::date
)
returning id as svc \gset
select tests.clear_auth();

insert into public.jobs (org_id, property_id, service_id, title, status)
values (:'org'::uuid, :'prop'::uuid, :'svc'::uuid, 'Fall aeration', 'unscheduled')
returning id as job \gset
insert into public.visits (
  org_id, job_id, property_id, sort, occurrence_date, scheduled_date, status, crew_size
)
values (:'org'::uuid, :'job'::uuid, :'prop'::uuid, 0, :'today'::date, null, 'scheduled', 1)
returning id as visit \gset
insert into public.crews (org_id, name, active)
values (:'org'::uuid, 'Truck 5', true)
returning id as crew \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');

select is(
  public.job_seasonal_warn_state(:'job'::uuid, :'today'::date),
  'warn',
  'unscheduled past warn date is warn'
);

select is(
  public.job_seasonal_warn_state(:'job'::uuid, (:'warn_day'::date - 1)),
  'ok',
  'before warn date while unscheduled is ok'
);

select ok(
  (
    select (i ->> 'seasonal_warn')::boolean
    from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'unassigned') i
    where i ->> 'id' = :'visit'
  ),
  'tray marks unscheduled past-warn visit seasonal_warn'
);

select ok(
  public.assign_visit(:'visit'::uuid, :'crew'::uuid, :'today'::date, 0) is not null,
  'dispatcher can schedule the seasonal visit'
);

select is(
  public.job_seasonal_warn_state(:'job'::uuid, :'today'::date),
  'cleared',
  'scheduling clears the seasonal warning'
);

select * from finish();
