select plan(11);

select tests.create_user('split-owner@example.com', 'Split Owner') as owner \gset
select tests.create_user('split-sales@example.com', 'Split Sales') as sales \gset
select tests.create_user('split-crew@example.com', 'Split Crew') as crew \gset
select tests.create_user('split-reader@example.com', 'Split Reader') as reader \gset
select tests.create_user('split-other@example.com', 'Split Other') as other \gset

select tests.create_org('Split One', 'split-one', :'owner'::uuid) as org \gset
select tests.create_org('Split Two', 'split-two', :'other'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
select tests.add_member(:'org'::uuid, :'reader'::uuid, 'read_only');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '1 Main', 'Springfield', 'IL', '62704')
returning id as prop \gset

select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Spring work') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price, sort)
values (:'org'::uuid, :'vid'::uuid, 'Mowing', 'included', 40, 0)
returning id as mow \gset
insert into public.quote_line_items (org_id, version_id, name, state, price, sort)
values (:'org'::uuid, :'vid'::uuid, 'Cleanup', 'included', 80, 1)
returning id as cleanup \gset

select public.quote_send(:'qid'::uuid) as tok \gset
select tests.authenticate_anon();
select public.quote_accept(:'tok'::uuid, 'Pat Buyer', 'pat@example.com', true, 'ua', null, null);
select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ select public.split_accepted_quote(%L::uuid, %L::jsonb) $$,
    :'qid',
    json_build_array(
      json_build_object('title', 'Mow', 'line_ids', json_build_array(:'mow')),
      json_build_object('title', 'Clean', 'line_ids', json_build_array(:'cleanup'))
    )::text
  ),
  '42501',
  null,
  'crew cannot split a quote'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select throws_ok(
  format(
    $$ select public.split_accepted_quote(%L::uuid, %L::jsonb) $$,
    :'qid',
    json_build_array(json_build_object('title', 'Only', 'line_ids', json_build_array(:'mow')))::text
  ),
  '22023',
  null,
  'one job is not a split'
);

select public.split_accepted_quote(
  :'qid'::uuid,
  json_build_array(
    json_build_object('title', 'Mow visit', 'line_ids', json_build_array(:'mow')),
    json_build_object('title', 'Cleanup visit', 'line_ids', json_build_array(:'cleanup'))
  )::jsonb
) as split \gset

select is((select count(*) from public.jobs where quote_id = :'qid'::uuid), 2::bigint, 'split creates two jobs');
select is(
  (select count(*) from public.job_quote_lines where org_id = :'org'::uuid),
  2::bigint,
  'each line is attached to one job'
);
select throws_ok(
  format(
    $$ select public.split_accepted_quote(%L::uuid, %L::jsonb) $$,
    :'qid',
    json_build_array(
      json_build_object('title', 'Again', 'line_ids', json_build_array(:'mow')),
      json_build_object('title', 'Again 2', 'line_ids', json_build_array(:'cleanup'))
    )::text
  ),
  '22023',
  null,
  'a quote cannot be split twice'
);

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is((select count(*) from public.job_quote_lines), 2::bigint, 'sales can read the split lines');

select tests.authenticate_as(:'reader'::uuid, :'org'::uuid, 'read_only');
select is((select count(*) from public.job_quote_lines), 2::bigint, 'read only can see the split lines');
select throws_ok(
  format(
    $$ insert into public.job_quote_lines (org_id, job_id, quote_line_item_id)
       select %L, id, %L from public.jobs where quote_id = %L limit 1 $$,
    :'org', :'mow', :'qid'
  ),
  '42501',
  null,
  'read only cannot write split lines'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is((select count(*) from public.job_quote_lines), 0::bigint, 'crew cannot read split lines');

select tests.authenticate_as(:'other'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.job_quote_lines), 0::bigint, 'another company cannot read split lines');
select throws_ok(
  format($$ select public.split_accepted_quote(%L::uuid, '[]'::jsonb) $$, :'qid'),
  'P0002',
  null,
  'another company cannot split the quote'
);

select * from finish();
