-- S11: revoke phone → SQLSTATE 28000 (HTTP 401); unsynced started visits listed.

select plan(12);

select tests.create_user('revoke-owner@example.com', 'Revoke Owner') as owner \gset
select tests.create_user('revoke-dispatch@example.com', 'Revoke Dispatch') as dispatcher \gset
select tests.create_user('revoke-lead@example.com', 'Revoke Lead') as lead \gset
select tests.create_user('revoke-hand@example.com', 'Revoke Hand') as hand \gset

select tests.create_org('Revoke Co', 'revoke-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'hand'::uuid, 'crew');

select (timezone('America/Chicago', now()))::date as today \gset

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Larkspur') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1503 Larkspur', 'Springfield', 'IL', '62704')
returning id as prop \gset
insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'prop'::uuid, 'Mow') returning id as job \gset

insert into public.crews (org_id, name)
values (:'org'::uuid, 'North') returning id as crew \gset
insert into public.crew_members (org_id, crew_id, profile_id) values
  (:'org'::uuid, :'crew'::uuid, :'lead'::uuid),
  (:'org'::uuid, :'crew'::uuid, :'hand'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew'::uuid;

insert into public.routes (org_id, crew_id, date, status)
values (:'org'::uuid, :'crew'::uuid, :'today'::date, 'published')
returning id as route \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status, started_at
) values (
  :'org'::uuid, :'job'::uuid, :'prop'::uuid, :'route'::uuid, 1, :'today'::date, :'today'::date,
  'in_progress', now() - interval '20 minutes'
) returning id as visit \gset

select has_table('public', 'crew_phone_revocations', 'crew_phone_revocations exists');
select ok(
  has_table_privilege('authenticated', 'public.crew_phone_revocations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.crew_phone_revocations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.crew_phone_revocations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.crew_phone_revocations', 'DELETE'),
  'revocations are office-readable and not directly writable'
);
select ok(
  (
    select bool_and(
      not has_function_privilege('anon', fn, 'execute')
      and has_function_privilege('authenticated', fn, 'execute')
    )
    from (
      values
        ('public.office_revoke_phone(uuid)'),
        ('public.office_clear_phone_revoke(uuid)')
    ) as fns(fn)
  ),
  'office revoke RPCs are granted to authenticated only'
);

select tests.authenticate_as(:'hand'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.office_revoke_phone(%L::uuid) $$, :'lead'),
  '42501',
  null,
  'a crew member cannot revoke a phone'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.office_revoke_phone(:'lead'::uuid) as revoke_body \gset
select is(
  (:'revoke_body'::jsonb->>'profile_id')::uuid,
  :'lead'::uuid,
  'revoke returns the profile id'
);
select is(
  jsonb_array_length(:'revoke_body'::jsonb->'unsynced_visits'),
  1,
  'revoke lists the started-but-unsynced visit'
);
select is(
  :'revoke_body'::jsonb#>>'{unsynced_visits,0,id}',
  :'visit',
  'unsynced visit id matches the in-progress stop'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select throws_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'today'),
  '28000',
  'phone revoked',
  'revoked pack download returns 401 (SQLSTATE 28000)'
);
select throws_ok(
  $$ select public.crew_sync('[]'::jsonb) $$,
  '28000',
  'phone revoked',
  'revoked sync returns 401 (SQLSTATE 28000)'
);
select throws_ok(
  format($$ select public.crew_ack_day_pack(%L::date, %L::uuid) $$, :'today', :'crew'),
  '28000',
  'phone revoked',
  'revoked ack returns 401 (SQLSTATE 28000)'
);

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select lives_ok(
  format($$ select public.office_clear_phone_revoke(%L::uuid) $$, :'lead'),
  'office can clear a revoke'
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select lives_ok(
  format($$ select public.crew_day_pack(%L::date) $$, :'today'),
  'pack works again after office clears the revoke'
);

select * from finish();
