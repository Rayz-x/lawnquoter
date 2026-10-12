-- Abandoned instant quotes are office-readable and not writable by the app roles.

select plan(6);

select tests.create_user('iq-owner@example.com', 'IQ Owner') as owner1 \gset
select tests.create_user('iq-sales@example.com', 'IQ Sales') as sales1 \gset
select tests.create_user('iq-crew@example.com', 'IQ Crew') as crew1 \gset
select tests.create_user('iq-owner2@example.com', 'IQ Owner Two') as owner2 \gset
select tests.create_org('IQ One', 'iq-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('IQ Two', 'iq-two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

insert into public.instant_quote_events (org_id, kind, address, utm_source)
values (:'org1'::uuid, 'abandoned', '1 Oak St', 'facebook')
returning id as event1 \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select is(
  (select count(*) from public.instant_quote_events),
  1::bigint,
  'owner can read an abandoned quote'
);

select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
select is(
  (select utm_source from public.instant_quote_events where id = :'event1'::uuid),
  'facebook',
  'sales can read an abandoned quote'
);

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is(
  (select count(*) from public.instant_quote_events),
  0::bigint,
  'crew reads zero abandoned quotes'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.instant_quote_events),
  0::bigint,
  'another company reads zero abandoned quotes'
);

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select throws_ok(
  format(
    $$ insert into public.instant_quote_events (org_id, kind, address) values (%L, 'abandoned', '2 Oak St') $$,
    :'org1'
  ),
  '42501',
  null,
  'office cannot insert abandoned quotes'
);

select tests.authenticate_anon();
select throws_ok(
  $$ select count(*) from public.instant_quote_events $$,
  '42501',
  null,
  'anon cannot read abandoned quotes'
);

select tests.clear_auth();
select finish();
