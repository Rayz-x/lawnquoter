-- Level billing already charges the season. The per-visit batch must leave those visits alone.

select plan(4);

select tests.create_user('level-batch-owner@example.com', 'Level Batch Owner') as owner \gset
select tests.create_org('Level Batch Co', 'level-batch-co', :'owner'::uuid) as org \gset

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date - 2) as day \gset
select date_trunc('month', :'today'::date)::date as month_start \gset
select (date_trunc('month', :'today'::date) + interval '1 month - 1 day')::date as month_end \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

insert into public.accounts (org_id, name) values (:'org'::uuid, 'Level Account') returning id as acct_level \gset
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Visit Account') returning id as acct_visit \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct_level'::uuid, '1 Level Ln', 'Nashville', 'TN', '37201')
returning id as prop_level \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct_visit'::uuid, '2 Visit Ln', 'Nashville', 'TN', '37201')
returning id as prop_visit \gset

select public.quote_create(:'acct_level'::uuid, :'prop_level'::uuid, 'Level mow') as q_level \gset
select public.quote_current_version(:'q_level'::uuid) as vid_level \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort)
values (:'org'::uuid, :'vid_level'::uuid, 'Mow', 'included', 1, 'visit', 80, 1, 20, 0)
returning id as line_level \gset

select public.quote_create(:'acct_visit'::uuid, :'prop_visit'::uuid, 'Visit mow') as q_visit \gset
select public.quote_current_version(:'q_visit'::uuid) as vid_visit \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort)
values (:'org'::uuid, :'vid_visit'::uuid, 'Mow', 'included', 1, 'visit', 40, 1, 10, 0)
returning id as line_visit \gset

update public.quotes set status = 'accepted' where id in (:'q_level'::uuid, :'q_visit'::uuid);

select tests.clear_auth();

insert into public.agreements (
  org_id, account_id, property_id, quote_id, quote_version_id, kind, status, start_date
) values (
  :'org'::uuid, :'acct_level'::uuid, :'prop_level'::uuid, :'q_level'::uuid, :'vid_level'::uuid,
  'recurring', 'active', :'month_start'::date
) returning id as agr_level \gset
insert into public.agreements (
  org_id, account_id, property_id, quote_id, quote_version_id, kind, status, start_date
) values (
  :'org'::uuid, :'acct_visit'::uuid, :'prop_visit'::uuid, :'q_visit'::uuid, :'vid_visit'::uuid,
  'recurring', 'active', :'month_start'::date
) returning id as agr_visit \gset

update public.agreements
set billing_mode = 'level', billing_months = 12
where id = :'agr_level'::uuid;

insert into public.jobs (org_id, agreement_id, property_id, quote_id, title, status)
values (:'org'::uuid, :'agr_level'::uuid, :'prop_level'::uuid, :'q_level'::uuid, 'Level mow', 'scheduled')
returning id as job_level \gset
insert into public.jobs (org_id, agreement_id, property_id, quote_id, title, status)
values (:'org'::uuid, :'agr_visit'::uuid, :'prop_visit'::uuid, :'q_visit'::uuid, 'Visit mow', 'scheduled')
returning id as job_visit \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr_level'::uuid, :'job_level'::uuid, :'prop_level'::uuid, 0, :'day'::date, :'day'::date, 'scheduled'
) returning id as visit_level \gset
insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr_visit'::uuid, :'job_visit'::uuid, :'prop_visit'::uuid, 0, :'day'::date, :'day'::date, 'scheduled'
) returning id as visit_per \gset

insert into public.visit_tasks (org_id, visit_id, label, source_line_item_id, sort) values
  (:'org'::uuid, :'visit_level'::uuid, 'Mow', :'line_level'::uuid, 0),
  (:'org'::uuid, :'visit_per'::uuid, 'Mow', :'line_visit'::uuid, 0);

select gen_random_uuid() as photo_level \gset
select gen_random_uuid() as photo_per \gset
insert into storage.objects (bucket_id, name) values
  ('visit-photos', :'org' || '/' || :'visit_level' || '/' || :'photo_level' || '.jpg'),
  ('visit-photos', :'org' || '/' || :'visit_per' || '/' || :'photo_per' || '.jpg');
insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id) values
  (
    :'org'::uuid, :'visit_level'::uuid, 'after',
    :'org' || '/' || :'visit_level' || '/' || :'photo_level' || '.jpg',
    now(), :'photo_level'::uuid
  ),
  (
    :'org'::uuid, :'visit_per'::uuid, 'after',
    :'org' || '/' || :'visit_per' || '/' || :'photo_per' || '.jpg',
    now(), :'photo_per'::uuid
  );

update public.visits
set status = 'completed', completed_at = now()
where id in (:'visit_level'::uuid, :'visit_per'::uuid);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.create_invoices_batch(:'month_start'::date, :'month_end'::date) as batch \gset

select is((:'batch')::jsonb->>'visit_count', '1', 'only the per-visit agreement is billed');
select is(
  (select billed_invoice_id is null from public.visits where id = :'visit_level'::uuid),
  true,
  'a level-billed visit stays unbilled by the visit batch'
);
select is(
  (select billed_invoice_id is not null from public.visits where id = :'visit_per'::uuid),
  true,
  'a per-visit agreement is still billed'
);
select is(
  (select count(*)::int from public.invoices where org_id = :'org'::uuid and account_id = :'acct_level'::uuid and source = 'visit'),
  0,
  'the level account gets no per-visit invoice'
);

select * from finish();
