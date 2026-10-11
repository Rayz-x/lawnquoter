-- S02: seasons, pause with resume_on, end agreement.
-- Spec: internal/tickets/is-wave2/S02_35d0.md

select plan(21);

select has_column('public', 'orgs', 'season_start_month', 'orgs.season_start_month exists');
select has_function('public', 'pause_agreement', array['uuid', 'date'], 'pause_agreement exists');
select has_function('public', 'resume_agreement', array['uuid'], 'resume_agreement exists');
select has_function('public', 'end_agreement', array['uuid', 'date'], 'end_agreement exists');
select has_function('public', 'update_org_season', array['integer', 'integer', 'integer', 'integer'], 'update_org_season exists');

select ok(
  private.date_in_season('2026-04-01'::date, 4, 1, 11, 15),
  'Apr 1 is in the default season'
);
select ok(
  private.date_in_season('2026-11-15'::date, 4, 1, 11, 15),
  'Nov 15 is in the default season'
);
select ok(
  not private.date_in_season('2026-11-16'::date, 4, 1, 11, 15),
  'Nov 16 is outside the default season'
);

select tests.create_user('season-owner@example.com', 'Season Owner') as owner \gset
select tests.create_user('season-dispatch@example.com', 'Season Dispatch') as dispatcher \gset
select tests.create_org('Season Co', 'season-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');

update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;

select is(
  (select season_start_month::integer from public.orgs where id = :'org'::uuid),
  4,
  'new orgs default season start month to April'
);
select is(
  (select season_end_day::integer from public.orgs where id = :'org'::uuid),
  15,
  'new orgs default season end day to the 15th'
);

select private.org_local_today(:'org'::uuid) as today \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Season Account')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Season', 'Chicago', 'IL', '60601')
returning id as prop \gset

-- Narrow season: today through today+21 so a 70-day horizon would overshoot.
update public.orgs
set season_start_month = extract(month from :'today'::date)::integer,
    season_start_day = extract(day from :'today'::date)::integer,
    season_end_month = extract(month from (:'today'::date + 21))::integer,
    season_end_day = extract(day from (:'today'::date + 21))::integer
where id = :'org'::uuid;

insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow, start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly',
  extract(dow from :'today'::date)::integer, :'today'::date, 'active'
) returning id as agr \gset

insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr'::uuid, :'prop'::uuid, 'Season mow')
returning id as job \gset

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.generate_agreement_visits(:'agr'::uuid, :'today'::date + 70) as created \gset

select ok(
  :'created'::integer > 0,
  'generation creates in-season visits'
);

select ok(
  (
    select count(*) = 0
    from public.visits
    where agreement_id = :'agr'::uuid
      and status <> 'cancelled'
      and not private.date_in_season(
        occurrence_date,
        (select season_start_month from public.orgs where id = :'org'::uuid),
        (select season_start_day from public.orgs where id = :'org'::uuid),
        (select season_end_month from public.orgs where id = :'org'::uuid),
        (select season_end_day from public.orgs where id = :'org'::uuid)
      )
  ),
  'no visits outside season'
);

select ok(
  (select max(occurrence_date) from public.visits where agreement_id = :'agr'::uuid and status <> 'cancelled')
    <= :'today'::date + 21,
  'generation stops at the season end'
);

-- Pause until further notice: no generation.
select public.pause_agreement(:'agr'::uuid, null);
select throws_ok(
  format($$ select public.generate_agreement_visits(%L, %L) $$, :'agr', :'today'::date + 70),
  '22023',
  null,
  'paused until further notice does not generate visits'
);

-- Resume, then pause with a future resume date.
select public.resume_agreement(:'agr'::uuid);
select public.pause_agreement(:'agr'::uuid, :'today'::date + 14);

select is(
  (select status::text from public.agreements where id = :'agr'::uuid),
  'paused',
  'agreement is paused with a resume date'
);

select ok(
  (
    select count(*) = 0
    from public.visits
    where agreement_id = :'agr'::uuid
      and status = 'scheduled'
      and occurrence_date >= :'today'::date
      and occurrence_date < :'today'::date + 14
  ),
  'pause cancels scheduled visits before the resume date'
);

-- Simulate resume day: bump resume_on to today (column is RPC-only for members).
select tests.clear_auth();
update public.agreements
set resume_on = :'today'::date
where id = :'agr'::uuid;

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.generate_agreement_visits(:'agr'::uuid, :'today'::date + 21) as after_resume \gset

select is(
  (select status::text from public.agreements where id = :'agr'::uuid),
  'active',
  'paused agreement resumes on date during generation'
);

select ok(
  (
    select count(*) > 0
    from public.visits
    where agreement_id = :'agr'::uuid
      and status = 'scheduled'
      and occurrence_date >= :'today'::date
  ),
  'generation after resume date restores scheduled visits'
);

-- End keeps completed visits, cancels future scheduled.
select id as visit_keep
from public.visits
where agreement_id = :'agr'::uuid
  and status = 'scheduled'
  and occurrence_date = :'today'::date
limit 1
\gset

select tests.clear_auth();
select gen_random_uuid() as client_after \gset
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_keep' || '/' || :'client_after' || '.jpg');
insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
values (
  :'org'::uuid, :'visit_keep'::uuid, 'after',
  :'org' || '/' || :'visit_keep' || '/' || :'client_after' || '.jpg',
  now(), :'client_after'::uuid
);

update public.visits
set status = 'completed', completed_at = now()
where id = :'visit_keep'::uuid;

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.end_agreement(:'agr'::uuid, :'today'::date);

select is(
  (select status::text from public.agreements where id = :'agr'::uuid),
  'ended',
  'end agreement sets status ended'
);

select is(
  (select status::text from public.visits where id = :'visit_keep'::uuid),
  'completed',
  'end keeps completed visits'
);

select ok(
  (
    select count(*) = 0
    from public.visits
    where agreement_id = :'agr'::uuid
      and status = 'scheduled'
      and occurrence_date > :'today'::date
  ),
  'end cancels future untouched visits'
);

select * from finish();
