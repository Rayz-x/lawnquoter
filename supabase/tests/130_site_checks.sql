-- Site-check schema, org setting defaults, and RLS.
-- Crew may select checks attached to a visit they can read; they never get
-- price columns from this table (there are none). Cross-org denied.

select plan(31);

select has_table('public', 'site_checks', 'site_checks exists');
select has_type('public', 'site_check_status', 'site_check_status enum exists');
select has_type('public', 'site_check_origin', 'site_check_origin enum exists');
select has_type('public', 'site_check_method', 'site_check_method enum exists');
select has_type('public', 'quantity_source', 'quantity_source enum exists');

select has_column('public', 'quote_line_items', 'site_check_reasons', 'line reasons column exists');
select has_column('public', 'quote_line_items', 'verified_price', 'verified_price exists');
select has_column('public', 'quote_line_items', 'verified_at', 'verified_at exists');
select has_column('public', 'quote_line_items', 'price_locked', 'price_locked exists');
select has_column('public', 'quote_line_items', 'quantity_source', 'quantity_source exists');
select has_column('public', 'quotes', 'site_check_status', 'quote site_check_status exists');

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'site_checks'
      and column_name in (
        'price', 'cost', 'margin', 'amount', 'verified_price', 'range_low', 'range_high'
      )
  ),
  0::bigint,
  'site_checks has no price or money columns'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'site_checks_one_open_per_quote'
  ),
  'one-open-per-quote unique index exists'
);

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('o2@example.com', 'Owner Two') as owner2 \gset
select tests.create_user('c1@example.com', 'Crew One') as crew1 \gset
select tests.create_user('l1@example.com', 'Lead One') as lead1 \gset
select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Two', 'two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');
select tests.add_member(:'org1'::uuid, :'lead1'::uuid, 'crew_lead');

select is(
  private.site_check_auto_approve(:'org1'::uuid),
  false,
  'auto-approve defaults off when settings key is absent'
);
select is(
  private.site_check_threshold(:'org1'::uuid),
  0.55,
  'confidence threshold defaults to 0.55'
);

select tests.clear_auth();
update public.orgs
set settings = settings || jsonb_build_object(
  'site_check_auto_approve', true,
  'site_check_threshold', 0.60
)
where id = :'org1'::uuid;

select is(
  private.site_check_auto_approve(:'org1'::uuid),
  true,
  'auto-approve reads the org setting when set'
);
select is(
  private.site_check_threshold(:'org1'::uuid),
  0.60,
  'threshold reads the org setting when set'
);

-- Reset auto-approve to the product default for the rest of the file.
update public.orgs
set settings = (settings - 'site_check_auto_approve') || jsonb_build_object('site_check_threshold', 0.55)
where id = :'org1'::uuid;

select is(
  private.site_check_auto_approve(:'org1'::uuid),
  false,
  'auto-approve returns to default off after key removal'
);

select (timezone('America/Chicago', now()))::date as today \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.accounts (org_id, name)
values (:'org1'::uuid, 'Pat')
returning id as acct \gset

insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org1'::uuid, :'acct'::uuid, '1 Main', 'Springfield', 'IL', '62704'
) returning id as prop \gset

select public.quote_create(:'acct'::uuid, :'prop'::uuid, 'Spring beds') as qid \gset

insert into public.site_checks (
  org_id, quote_id, property_id, status, origin, method, reasons, line_ids
) values (
  :'org1'::uuid, :'qid'::uuid, :'prop'::uuid, 'open', 'acceptance', 'desk',
  array['low_confidence'], array[]::uuid[]
) returning id as sc1 \gset

select ok(:'sc1'::uuid is not null, 'owner can insert a site check');
select is(
  (select count(*) from public.site_checks where id = :'sc1'::uuid),
  1::bigint,
  'owner can select own site check'
);

select throws_ok(
  format(
    $$ insert into public.site_checks (
         org_id, quote_id, property_id, status, origin, method, reasons, line_ids
       ) values (
         %L, %L, %L, 'open', 'acceptance', 'desk', array['low_confidence'], array[]::uuid[]
       ) $$,
    :'org1', :'qid', :'prop'
  ),
  '23505',
  null,
  'second open site check on the same quote is rejected'
);

-- Lock constraint on quote lines
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (
  org_id, version_id, name, price, range_low, range_high, site_check_reasons
) values (
  :'org1'::uuid, :'vid'::uuid, 'Mulch beds', 296, 261, 349, array['low_confidence']
) returning id as lid \gset

select throws_ok(
  format(
    $$ update public.quote_line_items
       set price_locked = true, verified_price = null
       where id = %L $$,
    :'lid'
  ),
  '23514',
  null,
  'price_locked requires verified_price and verified_at'
);

update public.quote_line_items
set price_locked = true,
    verified_price = 280,
    verified_at = now()
where id = :'lid'::uuid;

select is(
  (select price_locked and verified_price = 280 from public.quote_line_items where id = :'lid'::uuid),
  true,
  'owner can lock a line at a verified price'
);

-- Cross-org: other owner sees none and cannot insert against org1 parents
select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is((select count(*) from public.site_checks), 0::bigint, 'other org sees no site checks');
select throws_ok(
  format(
    $$ insert into public.site_checks (
         org_id, quote_id, property_id, status, origin, method, reasons, line_ids
       ) values (
         %L, %L, %L, 'open', 'acceptance', 'desk', array['manual'], array[]::uuid[]
       ) $$,
    :'org1', :'qid', :'prop'
  ),
  '42501',
  null,
  'other org cannot insert a site check into org1'
);

-- Crew without a visit attachment sees nothing
select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is((select count(*) from public.site_checks), 0::bigint, 'crew sees no unattached site check');

-- Attach a visit on today's published route so crew_can_read_visit applies
select tests.clear_auth();

insert into public.jobs (org_id, property_id, title, status)
values (:'org1'::uuid, :'prop'::uuid, 'Site check stop', 'scheduled')
returning id as job \gset

insert into public.crews (org_id, name)
values (:'org1'::uuid, 'North')
returning id as crew_north \gset

insert into public.crew_members (org_id, crew_id, profile_id) values
  (:'org1'::uuid, :'crew_north'::uuid, :'crew1'::uuid),
  (:'org1'::uuid, :'crew_north'::uuid, :'lead1'::uuid);

update public.crews set default_lead_id = :'lead1'::uuid where id = :'crew_north'::uuid;

insert into public.routes (org_id, crew_id, date, status)
values (:'org1'::uuid, :'crew_north'::uuid, :'today'::date, 'published')
returning id as route_today \gset

insert into public.visits (
  org_id, job_id, property_id, route_id, sort,
  occurrence_date, scheduled_date, status
) values (
  :'org1'::uuid, :'job'::uuid, :'prop'::uuid, :'route_today'::uuid, 1,
  :'today'::date, :'today'::date, 'scheduled'
) returning id as visit_id \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
update public.site_checks
set visit_id = :'visit_id'::uuid, method = 'crew_stop', status = 'scheduled'
where id = :'sc1'::uuid;

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is(
  (select count(*) from public.site_checks where id = :'sc1'::uuid),
  1::bigint,
  'crew can select a site check attached to their in-window visit'
);
select is(
  (
    select count(*)
    from public.site_checks sc
    where sc.id = :'sc1'::uuid
      and sc.actuals is null
  ),
  1::bigint,
  'crew select returns the site_checks row without needing quote prices'
);

-- RLS UPDATE with a failing USING clause updates zero rows (no exception).
update public.site_checks set status = 'done' where id = :'sc1'::uuid;
select is(
  (select status::text from public.site_checks where id = :'sc1'::uuid),
  'scheduled',
  'crew cannot update site checks via the table'
);

select tests.authenticate_as(:'lead1'::uuid, :'org1'::uuid, 'crew_lead');
select is(
  (select count(*) from public.site_checks where id = :'sc1'::uuid),
  1::bigint,
  'crew_lead can select a site check on their visit'
);

-- Same-org guard: property from org2 cannot be attached
select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
insert into public.accounts (org_id, name)
values (:'org2'::uuid, 'Other')
returning id as acct2 \gset
insert into public.properties (
  org_id, account_id, address_line1, city, region, postal_code
) values (
  :'org2'::uuid, :'acct2'::uuid, '9 Other', 'Springfield', 'IL', '62704'
) returning id as prop2 \gset

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');
select throws_ok(
  format(
    $$ update public.site_checks set property_id = %L where id = %L $$,
    :'prop2', :'sc1'
  ),
  '23503',
  null,
  'site_checks rejects a property from another org'
);

select * from finish();
