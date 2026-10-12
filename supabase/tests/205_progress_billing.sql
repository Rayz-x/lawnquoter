-- Progress billing draws a percent of the chosen lines and stops at what is already billed.

select plan(6);

select tests.create_user('progress-owner@example.com', 'Progress Owner') as owner \gset
select tests.create_user('progress-crew@example.com', 'Progress Crew') as crew \gset
select tests.create_user('progress-other@example.com', 'Progress Other') as other \gset
select tests.create_org('Progress Co', 'progress-co', :'owner'::uuid) as org \gset
select tests.create_org('Progress Other Co', 'progress-other-co', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Progress Account') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '4 Progress Rd', 'Nashville', 'TN', '37201')
returning id as prop \gset
select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Patio') as quote \gset
select public.quote_current_version(:'quote'::uuid) as version \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort, selected)
values (:'org'::uuid, :'version'::uuid, 'Patio', 'included', 1, 'job', 1000, 8, 400, 0, true)
returning id as line \gset
update public.quotes set status = 'accepted' where id = :'quote'::uuid;

select public.create_progress_invoice(:'quote'::uuid, array[:'line'::uuid], 40) as first \gset
select is(
  (select total_cents from public.invoices where id = :'first'::uuid),
  40000::bigint,
  'forty percent of 1000 dollars is 400 dollars'
);
select public.create_progress_invoice(:'quote'::uuid, array[:'line'::uuid], 100) as second \gset
select is(
  (select total_cents from public.invoices where id = :'second'::uuid),
  60000::bigint,
  'the rest of the line is billed when the draw reaches 100 percent'
);
select throws_ok(
  format($$ select public.create_progress_invoice(%L, array[%L]::uuid[], 100) $$, :'quote', :'line'),
  '22023', null, 'a line already at 100 percent has nothing left to bill'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format($$ select public.create_progress_invoice(%L, array[%L]::uuid[], 10) $$, :'quote', :'line'),
  '42501', null, 'crew cannot create a progress invoice'
);

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');
select throws_ok(
  format($$ select public.create_progress_invoice(%L, array[%L]::uuid[], 10) $$, :'quote', :'line'),
  'P0002', null, 'another company cannot bill this quote'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format(
    $$ select public.create_progress_invoice(%L, array[%L]::uuid[], 50) $$,
    :'quote', '00000000-0000-4000-8000-000000000000'
  ),
  'P0002', null, 'a line from another quote is refused'
);

select * from finish();
