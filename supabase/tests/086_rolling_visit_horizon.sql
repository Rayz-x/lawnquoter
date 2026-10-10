-- S01: rolling about-10-week visit horizon (extend_visit_horizons).
-- Spec source: internal/tickets/81-S01.md

select plan(14);

select ok(
  not has_function_privilege('anon', 'public.extend_visit_horizons()', 'execute'),
  'anon has no execute on extend_visit_horizons'
);
select ok(
  not has_function_privilege('authenticated', 'public.extend_visit_horizons()', 'execute'),
  'authenticated has no execute on extend_visit_horizons'
);
select ok(
  has_function_privilege('service_role', 'public.extend_visit_horizons()', 'execute'),
  'service_role can execute extend_visit_horizons'
);

select tests.create_user('horizon-owner@example.com', 'Horizon Owner') as owner \gset
select tests.create_user('horizon-dispatch@example.com', 'Horizon Dispatch') as dispatcher \gset
select tests.create_org('Horizon Co', 'horizon-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');

update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;

select private.org_local_today(:'org'::uuid) as today \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Horizon Account')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Horizon', 'Chicago', 'IL', '60601')
returning id as prop \gset

insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly',
  extract(dow from :'today'::date)::integer, :'today'::date, 'active'
) returning id as agr \gset

insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr'::uuid, :'prop'::uuid, 'Weekly mow')
returning id as job \gset

insert into public.crews (org_id, name) values (:'org'::uuid, 'Truck 1')
returning id as crew_id \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select throws_ok(
  $$ select public.extend_visit_horizons() $$,
  '42501',
  null,
  'a signed-in member cannot run the nightly horizon job'
);

select tests.clear_auth();
select set_config('role', 'service_role', true);

select public.extend_visit_horizons() as first_created \gset
select ok(
  :'first_created'::integer > 0,
  'first extension creates visits out to the horizon'
);

select public.extend_visit_horizons() as second_created \gset
select is(
  :'second_created'::integer,
  0,
  'running the horizon job twice creates no duplicates'
);

select is(
  (
    select count(*)::integer
    from (
      select occurrence_date
      from public.visits
      where agreement_id = :'agr'::uuid
      group by occurrence_date
      having count(*) > 1
    ) dups
  ),
  0,
  'no duplicate occurrence dates after a double run'
);

select is(
  (select max(occurrence_date) from public.visits where agreement_id = :'agr'::uuid),
  :'today'::date + 70,
  'horizon lands on org-local today plus about 10 weeks'
);

select id as visit_move
from public.visits
where agreement_id = :'agr'::uuid
  and occurrence_date = :'today'::date + 14
\gset

select tests.clear_auth();
select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.assign_visit(
  :'visit_move'::uuid,
  :'crew_id'::uuid,
  (:'today'::date + 16)
) as moved_route \gset

select tests.clear_auth();
select set_config('role', 'service_role', true);
select public.extend_visit_horizons() as after_move \gset

select is(
  (
    select scheduled_date
    from public.visits
    where id = :'visit_move'::uuid
  ),
  :'today'::date + 16,
  'a moved visit keeps its new scheduled date after extension'
);
select is(
  (
    select occurrence_date
    from public.visits
    where id = :'visit_move'::uuid
  ),
  :'today'::date + 14,
  'a moved visit keeps its occurrence date after extension'
);
select is(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr'::uuid
      and occurrence_date = :'today'::date + 14
  ),
  1::bigint,
  'extension does not recreate a moved occurrence'
);
select is(:'after_move'::integer, 0, 'extension after a move adds nothing when the horizon is full');

-- TZ boundary: org-local today can differ from UTC. Use a second org so we
-- do not delete visits (agreement visits are cancelled, not deleted).
select tests.clear_auth();
select tests.create_user('horizon-tz@example.com', 'Horizon TZ') as tz_owner \gset
select tests.create_org('Horizon TZ Co', 'horizon-tz', :'tz_owner'::uuid) as org_tz \gset
update public.orgs set timezone = 'Pacific/Kiritimati' where id = :'org_tz'::uuid;
select private.org_local_today(:'org_tz'::uuid) as kir_today \gset

insert into public.accounts (org_id, name)
values (:'org_tz'::uuid, 'TZ Account')
returning id as acct_tz \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org_tz'::uuid, :'acct_tz'::uuid, '2 Horizon', 'Kiritimati', 'KI', '00000')
returning id as prop_tz \gset

insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org_tz'::uuid, :'acct_tz'::uuid, :'prop_tz'::uuid, 'recurring', 'weekly',
  extract(dow from :'kir_today'::date)::integer, :'kir_today'::date, 'active'
) returning id as agr_tz \gset

insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org_tz'::uuid, :'agr_tz'::uuid, :'prop_tz'::uuid, 'TZ mow');

select set_config('role', 'service_role', true);
select public.extend_visit_horizons() as kir_created \gset

select is(
  (select max(occurrence_date) from public.visits where agreement_id = :'agr_tz'::uuid),
  :'kir_today'::date + 70,
  'horizon through-date uses the company timezone, not UTC'
);

-- end_date caps the horizon
select tests.clear_auth();
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, end_date, status
) values (
  :'org_tz'::uuid, :'acct_tz'::uuid, :'prop_tz'::uuid, 'recurring', 'weekly',
  extract(dow from :'kir_today'::date)::integer, :'kir_today'::date, :'kir_today'::date + 21, 'active'
) returning id as agr_end \gset

insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org_tz'::uuid, :'agr_end'::uuid, :'prop_tz'::uuid, 'Ended mow');

select set_config('role', 'service_role', true);
select public.extend_visit_horizons() as ended_created \gset
select is(
  (select max(occurrence_date) from public.visits where agreement_id = :'agr_end'::uuid),
  :'kir_today'::date + 21,
  'extension stops at the agreement end date'
);

select * from finish();
