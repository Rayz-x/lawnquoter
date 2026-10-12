select plan(13);

select tests.create_user('meter-owner@example.com', 'Meter Owner') as owner \gset
select tests.create_user('meter-crew@example.com', 'Meter Crew') as crew \gset
select tests.create_user('meter-sales@example.com', 'Meter Sales') as sales \gset
select tests.create_user('meter-other@example.com', 'Meter Other') as other \gset
select tests.create_org('Meter Co', 'meter-co', :'owner'::uuid) as org \gset
select tests.create_org('Meter Other Co', 'meter-other-co', :'other'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');

select has_table('public', 'usage_meters', 'usage_meters exists');

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select public.record_usage('imagery_session');
select public.record_usage('imagery_session');
select public.record_usage('measurement');
select public.record_usage('measurement');
select is((select count(*) from public.usage_meters), 0::bigint, 'crew cannot read usage');
select throws_ok(
  format($$ insert into public.usage_meters (org_id, day, kind, count) values (%L, current_date, 'measurement', 9) $$, :'org'),
  '42501', null, 'crew cannot insert usage'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select count from public.usage_meters where org_id = :'org'::uuid and kind = 'imagery_session'),
  1,
  'an imagery session counts once per day'
);
select is(
  (select count from public.usage_meters where org_id = :'org'::uuid and kind = 'measurement'),
  2,
  'each saved measurement counts'
);
select throws_ok(
  format($$ insert into public.usage_meters (org_id, day, kind, count) values (%L, current_date, 'measurement', 9) $$, :'org'),
  '42501', null, 'owner cannot insert usage directly'
);
select throws_ok(
  format($$ insert into public.usage_meters (org_id, day, kind, count) values (%L, current_date, 'measurement', 9) $$, :'org2'),
  '42501', null, 'owner cannot insert usage for another company'
);
select is((select public.usage_totals() ->> 'imagery_sessions'), '1', 'the settings total counts imagery once');
select is((select public.usage_totals() ->> 'measurements'), '2', 'the settings total counts every measurement');

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is((select count(*) from public.usage_meters), 0::bigint, 'sales cannot read usage');
select throws_ok(
  format($$ insert into public.usage_meters (org_id, day, kind, count) values (%L, current_date, 'measurement', 9) $$, :'org'),
  '42501', null, 'sales cannot insert usage'
);

select tests.authenticate_as(:'other'::uuid, :'org2'::uuid, 'owner');
select public.record_usage('measurement');
select is((select sum(count) from public.usage_meters), 1::bigint, 'another company only sees its own usage');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is((select sum(count) from public.usage_meters), 3::bigint, 'the first company does not see the other meter');

select * from finish();
