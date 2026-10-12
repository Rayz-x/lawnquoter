-- Crew status: the crew can write its own row, the office can read it,
-- another company and a different crew cannot.

select plan(9);

select tests.create_user('cs-owner@example.com', 'Status Owner') as owner \gset
select tests.create_user('cs-owner2@example.com', 'Status Owner Two') as owner2 \gset
select tests.create_user('cs-lead@example.com', 'Status Lead') as lead \gset
select tests.create_user('cs-other@example.com', 'Status Other') as other \gset

select tests.create_org('Status One', 'statusone', :'owner'::uuid) as org \gset
select tests.create_org('Status Two', 'statustwo', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'other'::uuid, 'crew');

insert into public.crews (org_id, name) values (:'org'::uuid, 'Status Crew') returning id as crew_id \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew_id'::uuid, :'lead'::uuid);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select lives_ok(
  format(
    $$ insert into public.crew_status (org_id, crew_id, state) values (%L, %L, 'on_site') $$,
    :'org', :'crew_id'
  ),
  'the crew can set its status'
);
select lives_ok(
  format(
    $$ update public.crew_status set state = 'break' where crew_id = %L $$,
    :'crew_id'
  ),
  'the crew can change its status'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select state from public.crew_status where crew_id = :'crew_id'::uuid),
  'break',
  'the office can read the crew status'
);
select tests.clear_auth();

select tests.authenticate_as(:'other'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ insert into public.crew_status (org_id, crew_id, state) values (%L, %L, 'done') $$,
    :'org', :'crew_id'
  ),
  '42501',
  null,
  'a different crew cannot set the status'
);
select lives_ok(
  format(
    $$ update public.crew_status set state = 'done' where crew_id = %L $$,
    :'crew_id'
  ),
  'a different crew update does not error'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select state from public.crew_status where crew_id = :'crew_id'::uuid),
  'break',
  'a different crew cannot change the status'
);
select tests.clear_auth();

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.crew_status where crew_id = :'crew_id'::uuid),
  0::bigint,
  'another company cannot read the crew status'
);
select tests.clear_auth();

select tests.authenticate_anon();
select throws_ok(
  format(
    $$ insert into public.crew_status (org_id, crew_id, state) values (%L, %L, 'done') $$,
    :'org', :'crew_id'
  ),
  '42501',
  null,
  'anonymous cannot set crew status'
);
select tests.clear_auth();

select is(
  (select relreplident::text from pg_class where oid = 'public.crew_status'::regclass),
  'f',
  'crew status publishes the full row'
);

select * from finish();
