-- S03: vacation holds and weekday change from a date (issue #83).
-- Spec: Holds cancel visits in range (not made up). Weekday change from a
-- chosen date yields exactly one visit in the change week. Held ranges stay
-- held after a weekday change. Past visits are unaffected.

select plan(13);

select ok(
  has_function_privilege('authenticated', 'public.hold_agreement_visits(uuid,date,date,text)', 'execute')
  and not has_function_privilege('anon', 'public.hold_agreement_visits(uuid,date,date,text)', 'execute'),
  'authenticated can hold visits; anon cannot'
);

select tests.create_user('hold-owner@example.com', 'Hold Owner') as owner \gset
select tests.create_user('hold-dispatch@example.com', 'Hold Dispatch') as dispatcher \gset
select tests.create_org('Hold Co', 'hold-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');

update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;
-- Year-round season so 20261010217200's out-of-season skip never hides the
-- dates this test schedules.
update public.orgs
set season_start_month = 1, season_start_day = 1, season_end_month = 12, season_end_day = 31
where id = :'org'::uuid;
select private.org_local_today(:'org'::uuid) as today \gset

-- Anchor on a Tuesday so weekday math is stable.
select (:'today'::date + ((2 - extract(dow from :'today'::date)::integer + 7) % 7)) as tue \gset
select (:'tue'::date + 14) as hold_week_tue \gset
select (:'hold_week_tue'::date + 6) as hold_week_end \gset
select (:'tue'::date + 7) as change_week_tue \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Hold Account')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Vacation Ln', 'Chicago', 'IL', '60601')
returning id as prop \gset

insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', 2, :'tue'::date, 'active'
) returning id as agr \gset

insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr'::uuid, :'prop'::uuid, 'Weekly mow')
returning id as job \gset

-- Past occurrence (before org today). Horizon fill never creates these, so
-- insert directly — weekday change must leave it alone.
insert into public.visits (
  org_id, agreement_id, job_id, property_id,
  sort, occurrence_date, scheduled_date, status, crew_size, budget_minutes
) values (
  :'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid,
  0, :'tue'::date - 7, :'tue'::date - 7, 'scheduled', 1, 30
) returning id as visit_past \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.generate_agreement_visits(:'agr'::uuid, (:'tue'::date + 35)) as seeded \gset

select id as visit_held
from public.visits
where agreement_id = :'agr'::uuid
  and occurrence_date = :'hold_week_tue'::date
\gset

select lives_ok(
  format(
    $$ select public.hold_agreement_visits(%L, %L, %L, 'customer vacation') $$,
    :'agr', :'hold_week_tue', :'hold_week_end'
  ),
  'hold_agreement_visits accepts a date range'
);

select is(
  (select status::text from public.visits where id = :'visit_held'::uuid),
  'cancelled',
  'hold cancels the visit in the held range'
);

select is(
  (select cancel_reason from public.visits where id = :'visit_held'::uuid),
  'vacation',
  'hold records cancel_reason vacation'
);

select is(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr'::uuid
      and status = 'scheduled'
      and occurrence_date between :'hold_week_tue'::date and :'hold_week_end'::date
  ),
  0::bigint,
  'no scheduled visit remains inside the hold range'
);

-- Weekday change from the change-week Tuesday: Tuesday -> Thursday.
select lives_ok(
  format(
    $$ select public.update_agreement_schedule(%L, 'recurring', 'weekly', 4, %L) $$,
    :'agr', :'change_week_tue'
  ),
  'weekday can change from a chosen date'
);

select is(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr'::uuid
      and status = 'scheduled'
      and date_trunc('week', occurrence_date::timestamp)
        = date_trunc('week', :'change_week_tue'::date::timestamp)
  ),
  1::bigint,
  'change week produces exactly one scheduled visit'
);

select is(
  (
    select extract(dow from occurrence_date)::integer
    from public.visits
    where agreement_id = :'agr'::uuid
      and status = 'scheduled'
      and date_trunc('week', occurrence_date::timestamp)
        = date_trunc('week', :'change_week_tue'::date::timestamp)
  ),
  4,
  'the single change-week visit lands on the new weekday'
);

select is(
  (
    select count(*)
    from public.visits
    where agreement_id = :'agr'::uuid
      and status = 'scheduled'
      and occurrence_date between :'hold_week_tue'::date and :'hold_week_end'::date
  ),
  0::bigint,
  'held week never returns a scheduled visit after weekday change'
);

select is(
  (select status::text from public.visits where id = :'visit_held'::uuid),
  'cancelled',
  'the held visit stays cancelled (pin)'
);

select is(
  (select cancel_reason from public.visits where id = :'visit_held'::uuid),
  'vacation',
  'hold cancel_reason survives weekday change'
);

select is(
  (select status::text from public.visits where id = :'visit_past'::uuid),
  'scheduled',
  'past visits are unaffected by the weekday change'
);

-- Re-run horizon fill (fill_agreement_visits, merged with the season skip):
-- the held week must still be skipped.
select public.generate_agreement_visits(:'agr'::uuid, (:'tue'::date + 42));

select is(
  (
    select count(*) from public.visits
    where agreement_id = :'agr'::uuid
      and status <> 'cancelled'
      and occurrence_date between :'hold_week_tue'::date and :'hold_week_end'::date
  ),
  0::bigint,
  'refilling the horizon still skips held dates alongside the season check'
);

select * from finish();
