-- I03: Billing review queue — hold exclusion, partial/$0 resolve, upsell override note.

select plan(19);

select ok(
  not has_function_privilege('anon', 'public.office_billing_review_queue()', 'execute'),
  'anon has no execute on office_billing_review_queue'
);
select ok(
  has_function_privilege('authenticated', 'public.office_billing_review_queue()', 'execute'),
  'authenticated can execute office_billing_review_queue'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.office_resolve_billing_hold(uuid, text, uuid[], jsonb)',
    'execute'
  ),
  'anon has no execute on office_resolve_billing_hold'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.office_resolve_billing_hold(uuid, text, uuid[], jsonb)',
    'execute'
  ),
  'authenticated can execute office_resolve_billing_hold'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.hold_visit_for_billing(uuid, public.billing_hold_reason)',
    'execute'
  ),
  'anon has no execute on hold_visit_for_billing'
);

select tests.create_user('rev-owner@example.com', 'Review Owner') as owner \gset
select tests.create_user('rev-crew@example.com', 'Review Crew') as crew \gset
select tests.create_org('Review Co', 'review-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;
select private.org_local_today(:'org'::uuid) as today \gset

select gen_random_uuid() as client_p \gset
select gen_random_uuid() as client_z \gset
select gen_random_uuid() as client_u \gset
select gen_random_uuid() as enh_client \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (:'org'::uuid, 'Review Account', '555-0200', 'rev@example.com', 'bill@example.com', '2 Bill St')
returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '20 Review St', 'Nashville', 'TN', '37203')
returning id as prop \gset

insert into public.services (org_id, name, slug, kind) values (:'org'::uuid, 'Mow', 'mow', 'mowing')
returning id as svc \gset

insert into public.quotes (org_id, account_id, property_id, number, title, status, created_by)
values (:'org'::uuid, :'acct'::uuid, :'prop'::uuid, 1, 'Review quote', 'accepted', :'owner'::uuid)
returning id as quote \gset
insert into public.quote_versions (org_id, quote_id, version, frozen, created_by)
values (:'org'::uuid, :'quote'::uuid, 1, false, :'owner'::uuid)
returning id as qver \gset
insert into public.quote_sections (org_id, version_id, title, sort)
values (:'org'::uuid, :'qver'::uuid, 'Work', 0)
returning id as qsec \gset
insert into public.quote_line_items (
  org_id, version_id, section_id, service_id, name, state, qty, unit, price, hours, cost, selected, sort
) values
  (:'org'::uuid, :'qver'::uuid, :'qsec'::uuid, :'svc'::uuid, 'Mow front', 'included', 1, 'each', 40, 0.5, 10, true, 0),
  (:'org'::uuid, :'qver'::uuid, :'qsec'::uuid, :'svc'::uuid, 'Mow back', 'included', 1, 'each', 60, 0.5, 15, true, 1);

select id as line_front from public.quote_line_items
where version_id = :'qver'::uuid and name = 'Mow front' \gset
select id as line_back from public.quote_line_items
where version_id = :'qver'::uuid and name = 'Mow back' \gset
update public.quote_versions set frozen = true where id = :'qver'::uuid;

-- Jobs/visits/photos are written outside authenticated (column grants).
select tests.clear_auth();
insert into public.jobs (org_id, property_id, quote_id, title, status)
values (:'org'::uuid, :'prop'::uuid, :'quote'::uuid, 'Partly done visit', 'scheduled')
returning id as job_partial \gset
insert into public.jobs (org_id, property_id, quote_id, title, status)
values (:'org'::uuid, :'prop'::uuid, :'quote'::uuid, 'Zero visit', 'scheduled')
returning id as job_zero \gset
insert into public.jobs (org_id, property_id, quote_id, title, status)
values (:'org'::uuid, :'prop'::uuid, :'quote'::uuid, 'Upsell visit', 'scheduled')
returning id as job_upsell \gset

insert into public.visits (
  org_id, job_id, property_id, sort, occurrence_date, scheduled_date,
  status, crew_size, budget_minutes
) values
  (:'org'::uuid, :'job_partial'::uuid, :'prop'::uuid, 0, :'today'::date, :'today'::date,
   'scheduled', 1, 30)
returning id as visit_partial \gset
insert into public.visits (
  org_id, job_id, property_id, sort, occurrence_date, scheduled_date,
  status, crew_size, budget_minutes
) values
  (:'org'::uuid, :'job_zero'::uuid, :'prop'::uuid, 0, :'today'::date, :'today'::date,
   'scheduled', 1, 30)
returning id as visit_zero \gset
insert into public.visits (
  org_id, job_id, property_id, sort, occurrence_date, scheduled_date,
  status, crew_size, budget_minutes
) values
  (:'org'::uuid, :'job_upsell'::uuid, :'prop'::uuid, 0, :'today'::date, :'today'::date,
   'scheduled', 1, 30)
returning id as visit_upsell \gset

insert into storage.objects (bucket_id, name) values
  ('visit-photos', :'org' || '/' || :'visit_partial' || '/' || :'client_p' || '.jpg'),
  ('visit-photos', :'org' || '/' || :'visit_zero' || '/' || :'client_z' || '.jpg'),
  ('visit-photos', :'org' || '/' || :'visit_upsell' || '/' || :'client_u' || '.jpg');

insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id) values
  (
    :'org'::uuid, :'visit_partial'::uuid, 'after',
    :'org' || '/' || :'visit_partial' || '/' || :'client_p' || '.jpg',
    now(), :'client_p'::uuid
  ),
  (
    :'org'::uuid, :'visit_zero'::uuid, 'after',
    :'org' || '/' || :'visit_zero' || '/' || :'client_z' || '.jpg',
    now(), :'client_z'::uuid
  ),
  (
    :'org'::uuid, :'visit_upsell'::uuid, 'after',
    :'org' || '/' || :'visit_upsell' || '/' || :'client_u' || '.jpg',
    now(), :'client_u'::uuid
  );

update public.visits
set status = 'completed', completed_at = now()
where id in (:'visit_partial'::uuid, :'visit_zero'::uuid, :'visit_upsell'::uuid);

insert into public.visit_tasks (
  org_id, visit_id, label, quantity_text, source_line_item_id, sort
) values
  (:'org'::uuid, :'visit_partial'::uuid, 'Mow front', '1 each', :'line_front'::uuid, 0),
  (:'org'::uuid, :'visit_partial'::uuid, 'Mow back', '1 each', :'line_back'::uuid, 1),
  (:'org'::uuid, :'visit_zero'::uuid, 'Mow front', '1 each', :'line_front'::uuid, 0),
  (:'org'::uuid, :'visit_upsell'::uuid, 'Mow front', '1 each', :'line_front'::uuid, 0);

select id as task_front from public.visit_tasks
where visit_id = :'visit_partial'::uuid and label = 'Mow front' \gset
select id as task_back from public.visit_tasks
where visit_id = :'visit_partial'::uuid and label = 'Mow back' \gset

insert into public.enhancement_requests (
  org_id, visit_id, property_id, tag, note, status, client_id
) values (
  :'org'::uuid, :'visit_upsell'::uuid, :'prop'::uuid, 'mulch', 'beds', 'new', :'enh_client'::uuid
)
returning id as enh_id \gset

-- Hold the three visits for review
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.hold_visit_for_billing(:'visit_partial'::uuid, 'partly_done');
select public.hold_visit_for_billing(:'visit_zero'::uuid, 'photo_lost');
select public.hold_visit_for_billing(:'visit_upsell'::uuid, 'upsell_review');

-- Held visits are excluded from the invoice batch until resolved ------------------
select is(
  private.invoice_batch_visit_eligible(:'visit_partial'::uuid),
  false,
  'held visit is excluded from invoice batch'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.office_billing_review_queue() -> 'items') i
    where i ->> 'id' = :'visit_partial'
  ),
  'held visit appears in the billing review queue'
);

-- Partial resolve bills chosen lines only ---------------------------------------
select public.office_resolve_billing_hold(
  :'visit_partial'::uuid,
  'partial',
  array[:'task_front'::uuid],
  '[]'::jsonb
) as resolve_partial \gset

select is(
  (select count(*) from public.invoice_lines il
   join public.invoices i on i.id = il.invoice_id
   where i.visit_id = :'visit_partial'::uuid),
  1::bigint,
  'partial resolve bills chosen lines only'
);
select is(
  (select i.total_cents from public.invoices i where i.visit_id = :'visit_partial'::uuid),
  4000::bigint,
  'partial resolve total is the chosen line only ($40)'
);
select is(
  (select billing_held from public.visits where id = :'visit_partial'::uuid),
  false,
  'partial resolve clears the billing hold'
);

-- Upsell override without note fails --------------------------------------------
select throws_ok(
  format(
    $$ select public.office_resolve_billing_hold(
         %L::uuid,
         'full',
         null,
         jsonb_build_array(jsonb_build_object(
           'enhancement_request_id', %L::uuid,
           'amount_cents', 2500,
           'note', ''
         ))
       ) $$,
    :'visit_upsell', :'enh_id'
  ),
  '22023',
  null,
  'override without a note fails'
);

select throws_ok(
  format(
    $$ select public.office_resolve_billing_hold(
         %L::uuid,
         'full',
         null,
         jsonb_build_array(jsonb_build_object(
           'enhancement_request_id', %L::uuid,
           'amount_cents', 2500
         ))
       ) $$,
    :'visit_upsell', :'enh_id'
  ),
  '22023',
  null,
  'override missing note key fails'
);

-- Override with note succeeds and is audited ------------------------------------
select public.office_resolve_billing_hold(
  :'visit_upsell'::uuid,
  'full',
  null,
  jsonb_build_array(jsonb_build_object(
    'enhancement_request_id', :'enh_id'::uuid,
    'amount_cents', 2500,
    'note', 'Customer approved mulch on site'
  ))
) as resolve_upsell \gset

select ok(
  exists (
    select 1 from public.billing_events be
    join public.invoices i on i.id = be.invoice_id
    where i.visit_id = :'visit_upsell'::uuid
      and be.kind = 'upsell.override'
      and be.payload ->> 'note' = 'Customer approved mulch on site'
      and be.payload ->> 'actor_id' = :'owner'
      and (be.payload ->> 'amount_cents_before')::bigint = 0
      and (be.payload ->> 'amount_cents_after')::bigint = 2500
  ),
  'override with a note is audited (who, before/after, reason)'
);
select is(
  (select count(*) from public.invoice_lines il
   join public.invoices i on i.id = il.invoice_id
   where i.visit_id = :'visit_upsell'::uuid),
  2::bigint,
  'full resolve with upsell override includes visit task and override line'
);

-- $0 resolution marks visit billed-once with no charge --------------------------
select public.office_resolve_billing_hold(
  :'visit_zero'::uuid,
  'zero',
  null,
  '[]'::jsonb
) as resolve_zero \gset

select is(
  (select i.total_cents from public.invoices i where i.visit_id = :'visit_zero'::uuid),
  0::bigint,
  '$0 resolution creates a zero-total invoice'
);
select is(
  (select count(*) from public.invoice_lines il
   join public.invoices i on i.id = il.invoice_id
   where i.visit_id = :'visit_zero'::uuid),
  0::bigint,
  '$0 resolution has no charge lines'
);
select ok(
  exists (select 1 from public.invoices i where i.visit_id = :'visit_zero'::uuid),
  '$0 resolution marks the visit billed-once'
);
select is(
  private.invoice_batch_visit_eligible(:'visit_zero'::uuid),
  false,
  'billed $0 visit stays excluded from batch'
);

-- Crew cannot read the queue ----------------------------------------------------
select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  $$ select public.office_billing_review_queue() $$,
  '42501',
  null,
  'crew cannot read the billing review queue'
);

select * from finish();
