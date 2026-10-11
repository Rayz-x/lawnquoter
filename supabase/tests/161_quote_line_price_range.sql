-- An editor can write quote_line_items directly. RLS does not check the price.
-- The table rejects a price outside a complete low–high range, and a low above a high.
-- A missing bound is not a range. verified_price is not part of the check.

select plan(11);

select tests.create_user('range-owner@example.com', 'Range Owner') as owner \gset
select tests.create_org('Range Co', 'range-co', :'owner'::uuid) as org \gset
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset
select public.quote_create(:'acct'::uuid, null, 'Ranged mow') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset

select throws_ok(
  format(
    $$ insert into public.quote_line_items (org_id, version_id, name, price, range_low, range_high)
       values (%L, %L, 'Above', 100, 1, 2) $$,
    :'org', :'vid'
  ),
  '23514',
  'new row for relation "quote_line_items" violates check constraint "quote_line_items_price_in_range_chk"',
  'a direct insert with a price above the range is rejected'
);

select throws_ok(
  format(
    $$ insert into public.quote_line_items (org_id, version_id, name, price, range_low, range_high)
       values (%L, %L, 'Below', 50, 90, 120) $$,
    :'org', :'vid'
  ),
  '23514',
  'new row for relation "quote_line_items" violates check constraint "quote_line_items_price_in_range_chk"',
  'a direct insert with a price below the range is rejected'
);

insert into public.quote_line_items (org_id, version_id, name, price, range_low, range_high)
values (:'org'::uuid, :'vid'::uuid, 'At low', 90, 90, 120)
returning id as low_line \gset

select is(
  (select price from public.quote_line_items where id = :'low_line'::uuid),
  90::numeric,
  'a direct insert at the low end of the range is stored'
);

insert into public.quote_line_items (org_id, version_id, name, price, range_low, range_high)
values (:'org'::uuid, :'vid'::uuid, 'At high', 120, 90, 120)
returning id as high_line \gset

select is(
  (select price from public.quote_line_items where id = :'high_line'::uuid),
  120::numeric,
  'a direct insert at the high end of the range is stored'
);

select throws_ok(
  format(
    $$ update public.quote_line_items set price = 200 where id = %L $$,
    :'low_line'
  ),
  '23514',
  'new row for relation "quote_line_items" violates check constraint "quote_line_items_price_in_range_chk"',
  'a direct update that moves the price above the range is rejected'
);

select is(
  (select price from public.quote_line_items where id = :'low_line'::uuid),
  90::numeric,
  'a rejected price update leaves the in-range price'
);

select lives_ok(
  format(
    $$ insert into public.quote_line_items (org_id, version_id, name, price, range_low, range_high)
       values (%L, %L, 'No range', 100, null, null) $$,
    :'org', :'vid'
  ),
  'a direct insert with both bounds null is accepted'
);

select lives_ok(
  format(
    $$ insert into public.quote_line_items (org_id, version_id, name, price, range_low, range_high)
       values (%L, %L, 'High only', 1000, null, 2) $$,
    :'org', :'vid'
  ),
  'a direct insert with only the low bound null is accepted'
);

select lives_ok(
  format(
    $$ insert into public.quote_line_items (org_id, version_id, name, price, range_low, range_high)
       values (%L, %L, 'Low only', 0, 100, null) $$,
    :'org', :'vid'
  ),
  'a direct insert with only the high bound null is accepted'
);

select throws_ok(
  format(
    $$ insert into public.quote_line_items (org_id, version_id, name, price, range_low, range_high)
       values (%L, %L, 'Inverted', 15, 20, 10) $$,
    :'org', :'vid'
  ),
  '23514',
  'new row for relation "quote_line_items" violates check constraint "quote_line_items_price_in_range_chk"',
  'a direct insert with the low end above the high end is rejected'
);

select lives_ok(
  format(
    $$ update public.quote_line_items
       set price_locked = true, verified_price = 1, verified_at = now()
       where id = %L $$,
    :'high_line'
  ),
  'a verified price outside the range is accepted when the line price stays inside'
);

select * from finish();
