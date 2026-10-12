-- A parent with consolidated invoicing gets one invoice for its sites and its child accounts.

select plan(6);

select tests.create_user('consol-owner@example.com', 'Consol Owner') as owner \gset
select tests.create_user('consol-crew@example.com', 'Consol Crew') as crew \gset
select tests.create_user('consol-other@example.com', 'Consol Other') as other \gset
select tests.create_org('Consol Co', 'consol-co', :'owner'::uuid) as org \gset
select tests.create_org('Consol Other Co', 'consol-other-co', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date - 2) as day \gset
select date_trunc('month', :'today'::date)::date as month_start \gset
select (date_trunc('month', :'today'::date) + interval '1 month - 1 day')::date as month_end \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name, consolidated_invoicing)
values (:'org'::uuid, 'Parent Co', true) returning id as parent \gset
insert into public.accounts (org_id, name, parent_account_id)
values (:'org'::uuid, 'Child Site', :'parent'::uuid) returning id as child \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'child'::uuid, '9 Child St', 'Nashville', 'TN', '37201')
returning id as prop \gset

select public.quote_create(:'child'::uuid, :'prop'::uuid, 'Child mow') as quote \gset
select public.quote_current_version(:'quote'::uuid) as version \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort)
values (:'org'::uuid, :'version'::uuid, 'Mow', 'included', 1, 'visit', 40, 1, 10, 0)
returning id as line \gset
update public.quotes set status = 'accepted' where id = :'quote'::uuid;

select tests.clear_auth();
insert into public.agreements (
  org_id, account_id, property_id, quote_id, quote_version_id, kind, status, start_date
) values (
  :'org'::uuid, :'child'::uuid, :'prop'::uuid, :'quote'::uuid, :'version'::uuid,
  'recurring', 'active', :'month_start'::date
) returning id as agr \gset
insert into public.jobs (org_id, agreement_id, property_id, quote_id, title, status)
values (:'org'::uuid, :'agr'::uuid, :'prop'::uuid, :'quote'::uuid, 'Child mow', 'scheduled')
returning id as job \gset
insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid, 0, :'day'::date, :'day'::date, 'scheduled'
) returning id as visit \gset
insert into public.visit_tasks (org_id, visit_id, label, source_line_item_id, sort)
values (:'org'::uuid, :'visit'::uuid, 'Mow', :'line'::uuid, 0);

select gen_random_uuid() as photo \gset
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit' || '/' || :'photo' || '.jpg');
insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
values (
  :'org'::uuid, :'visit'::uuid, 'after',
  :'org' || '/' || :'visit' || '/' || :'photo' || '.jpg',
  now(), :'photo'::uuid
);
update public.visits set status = 'completed', completed_at = now() where id = :'visit'::uuid;

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.create_consolidated_invoice(:'parent'::uuid, :'month_start'::date, :'month_end'::date) as invoice \gset

select is(
  (select account_id from public.invoices where id = :'invoice'::uuid),
  :'parent'::uuid,
  'the consolidated invoice is billed to the parent'
);
select is(
  (select total_cents from public.invoices where id = :'invoice'::uuid and source = 'consolidated'),
  4000::bigint,
  'the child site visit is 40 dollars on the parent invoice'
);
select ok(
  (select description like '%9 Child St%' from public.invoice_lines where invoice_id = :'invoice'::uuid),
  'the line names the site'
);

select throws_ok(
  format(
    $$ select public.create_consolidated_invoice(%L, %L::date, %L::date) $$,
    :'parent', :'month_start', :'month_end'
  ),
  '22023', null, 'the same visit is not billed twice'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ select public.create_consolidated_invoice(%L, %L::date, %L::date) $$,
    :'parent', :'month_start', :'month_end'
  ),
  '42501', null, 'crew cannot create a consolidated invoice'
);

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');
select throws_ok(
  format(
    $$ select public.create_consolidated_invoice(%L, %L::date, %L::date) $$,
    :'parent', :'month_start', :'month_end'
  ),
  'P0002', null, 'another company cannot bill this account'
);

select * from finish();
