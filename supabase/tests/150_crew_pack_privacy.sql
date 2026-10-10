-- S23: crew day pack JSON must not expose price or customer contact keys.
-- Office phone under `office` is allowed; customer phone/email/price are not.

select plan(6);

select tests.create_user('s23-owner@example.com', 'S23 Owner') as owner \gset
select tests.create_user('s23-lead@example.com', 'S23 Lead') as lead \gset
select tests.create_org('S23 Org', 's23-org', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
update public.orgs set phone = '217-555-0230' where id = :'org'::uuid;

select (timezone('America/Chicago', now()))::date as today \gset

insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (
  :'org'::uuid, 'Quinlan Hollis', '555-0199', 'crew-secret@example.com',
  'bills-secret@example.com', '9 Billing Secret Ln'
) returning id as account \gset
insert into public.contacts (org_id, account_id, first_name, last_name, email, phone, is_primary)
values (:'org'::uuid, :'account'::uuid, 'Quinlan', 'Hollis', 'contact-secret@example.com', '555-0188', true);
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code, formatted_address)
values (
  :'org'::uuid, :'account'::uuid, '1503 Larkspur', 'Springfield', 'IL', '62704',
  '1503 Larkspur, Springfield, IL 62704'
) returning id as property \gset
insert into public.property_access (property_id, org_id, gate_code, access_notes)
values (:'property'::uuid, :'org'::uuid, '4815', 'side gate');

insert into public.quotes (org_id, account_id, property_id, number, title)
values (:'org'::uuid, :'account'::uuid, :'property'::uuid, 1, 'Weekly')
returning id as quote \gset
insert into public.quote_versions (org_id, quote_id, version)
values (:'org'::uuid, :'quote'::uuid, 1)
returning id as version \gset
insert into public.quote_line_items (org_id, version_id, name, price, cost, notes_crew)
values (:'org'::uuid, :'version'::uuid, 'Secret mow', 87.65, 12.00, 'priced note');

insert into public.crews (org_id, name)
values (:'org'::uuid, 'North') returning id as crew \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew'::uuid, :'lead'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew'::uuid;

insert into public.jobs (org_id, property_id, title)
values (:'org'::uuid, :'property'::uuid, 'Mow') returning id as job \gset
insert into public.routes (org_id, crew_id, date, status, revision)
values (:'org'::uuid, :'crew'::uuid, :'today'::date, 'published', 1)
returning id as route \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, occurrence_date, scheduled_date, sort, status, budget_minutes
) values (
  :'org'::uuid, :'job'::uuid, :'property'::uuid, :'route'::uuid,
  :'today'::date, :'today'::date, 1, 'scheduled', 45
);

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select public.crew_day_pack(:'today'::date) as pack \gset

select ok(
  (:'pack')::jsonb ? 'office'
  and (:'pack')::jsonb->'office' ? 'phone',
  'crew pack still includes office.phone'
);

select ok(
  not exists (
    select 1
    from jsonb_each((:'pack')::jsonb) as top(key, value)
    where top.key in ('price', 'cost', 'email', 'phone', 'billing_email')
  ),
  'crew pack top-level keys exclude price and contact'
);

select is(
  (
    select count(*)::int
    from (
      with recursive nodes(path, key, value) as (
        select key, key, value
        from jsonb_each((:'pack')::jsonb)
        union all
        select nodes.path || '.' || child.key, child.key, child.value
        from nodes
        cross join lateral (
          select key, value
          from jsonb_each(case when jsonb_typeof(nodes.value) = 'object' then nodes.value else '{}'::jsonb end)
          union all
          select ord::text, elem
          from jsonb_array_elements(case when jsonb_typeof(nodes.value) = 'array' then nodes.value else '[]'::jsonb end)
            with ordinality as arr(elem, ord)
        ) as child(key, value)
      )
      select path
      from nodes
      where key in ('price', 'cost', 'margin', 'amount', 'email', 'billing_email', 'billing_address_line1', 'first_name')
         or (key = 'phone' and path not like 'office%')
    ) leaks
  ),
  0,
  'crew RPC pack tree excludes price and customer contact keys'
);

select ok(
  position('555-0199' in :'pack') = 0
  and position('555-0188' in :'pack') = 0
  and position('crew-secret@example.com' in :'pack') = 0
  and position('bills-secret@example.com' in :'pack') = 0
  and position('contact-secret@example.com' in :'pack') = 0
  and position('87.65' in :'pack') = 0
  and position('Quinlan' in :'pack') = 0,
  'crew pack text omits customer phone, email, price, and first name'
);

select ok(position('217-555-0230' in :'pack') > 0, 'crew pack keeps the office phone');
select ok(position('Hollis' in :'pack') > 0, 'crew pack keeps customer last name only');

select * from finish();
