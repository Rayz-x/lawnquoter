-- S10: crew idle PIN set/verify; hash table is not client-readable.

select plan(8);

select has_table('public', 'crew_pins', 'crew_pins exists');

select tests.create_user('s10-owner@example.com', 'S10 Owner') as owner \gset
select tests.create_user('s10-lead@example.com', 'S10 Lead') as lead \gset
select tests.create_user('s10-hand@example.com', 'S10 Hand') as hand \gset
select tests.create_org('S10', 's10-pin', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'hand'::uuid, 'crew');

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select is(public.crew_pin_is_set(), false, 'PIN starts unset');

select lives_ok(
  $$ select public.set_crew_pin('2468') $$,
  'lead can set a PIN'
);
select is(public.crew_pin_is_set(), true, 'PIN is set after save');
select is(public.verify_crew_pin('2468'), true, 'correct PIN verifies');
select is(public.verify_crew_pin('0000'), false, 'wrong PIN is rejected');

select is(
  (select count(*) from public.crew_pins),
  0::bigint,
  'authenticated cannot read crew_pins rows directly'
);

select throws_ok(
  $$ select public.set_crew_pin('12') $$,
  '22023',
  'PIN must be 4 to 6 digits',
  'short PIN is rejected'
);

select * from finish();
