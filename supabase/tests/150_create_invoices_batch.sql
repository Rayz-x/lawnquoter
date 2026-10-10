-- I02: create_invoices_batch — per-account draft invoices from billable visits.
-- Seams: public.create_invoices_batch(date, date) return shape + ledger rows.

select plan(20);

select ok(
  not has_function_privilege('anon', 'public.create_invoices_batch(date, date)', 'execute'),
  'anon has no execute on create_invoices_batch'
);
select ok(
  has_function_privilege('authenticated', 'public.create_invoices_batch(date, date)', 'execute'),
  'authenticated can execute create_invoices_batch'
);

select tests.create_user('inv-owner@example.com', 'Inv Owner') as owner \gset
select tests.create_user('inv-crew@example.com', 'Inv Crew') as crew \gset
select tests.create_org('Invoice Co', 'invoice-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select (timezone('America/Chicago', now()))::date as today \gset
select (:'today'::date - 5) as day_a \gset
select (:'today'::date - 3) as day_b \gset
select (:'today'::date - 1) as day_c \gset
select date_trunc('month', :'today'::date)::date as month_start \gset
select (date_trunc('month', :'today'::date) + interval '1 month - 1 day')::date as month_end \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

-- Account A: fixed mow + ranged/verified aeration. Account B: flat edging.
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Account Alpha')
  returning id as acct_a \gset
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Account Beta')
  returning id as acct_b \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct_a'::uuid, '10 Alpha St', 'Springfield', 'IL', '62704')
  returning id as prop_a \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct_b'::uuid, '20 Beta Ave', 'Springfield', 'IL', '62704')
  returning id as prop_b \gset

select public.quote_create(:'acct_a'::uuid, :'prop_a'::uuid, 'Alpha weekly') as q_a \gset
select public.quote_current_version(:'q_a'::uuid) as vid_a \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort)
values (:'org'::uuid, :'vid_a'::uuid, 'Mow', 'included', 1, 'visit', 80, 1, 20, 0)
  returning id as line_mow \gset
insert into public.quote_line_items (
  org_id, version_id, name, state, qty, unit, price, range_low, range_high,
  verified_price, verified_at, price_locked, hours, cost, sort
) values (
  :'org'::uuid, :'vid_a'::uuid, 'Aeration', 'included', 1, 'visit', 95, 85, 100,
  90, now(), true, 1, 30, 1
) returning id as line_aerate \gset

select public.quote_create(:'acct_b'::uuid, :'prop_b'::uuid, 'Beta weekly') as q_b \gset
select public.quote_current_version(:'q_b'::uuid) as vid_b \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort)
values (:'org'::uuid, :'vid_b'::uuid, 'Edge', 'included', 1, 'visit', 50, 0.5, 10, 0)
  returning id as line_edge \gset

-- Unaccepted upsell quote on Alpha — must not bill.
select public.quote_create(:'acct_a'::uuid, :'prop_a'::uuid, 'Upsell mulch') as q_upsell \gset
select public.quote_current_version(:'q_upsell'::uuid) as vid_upsell \gset
insert into public.quote_line_items (org_id, version_id, name, state, qty, unit, price, hours, cost, sort)
values (:'org'::uuid, :'vid_upsell'::uuid, 'Mulch', 'included', 1, 'visit', 200, 1, 40, 0)
  returning id as line_mulch \gset

update public.quotes set status = 'accepted' where id in (:'q_a'::uuid, :'q_b'::uuid);

-- Scheduling tables: no authenticated INSERT; seed as the table owner.
select tests.clear_auth();

insert into public.agreements (
  org_id, account_id, property_id, quote_id, quote_version_id, kind, status, start_date, service_kind
) values (
  :'org'::uuid, :'acct_a'::uuid, :'prop_a'::uuid, :'q_a'::uuid, :'vid_a'::uuid,
  'recurring', 'active', :'month_start'::date, 'lawn'
) returning id as agr_a \gset
insert into public.agreements (
  org_id, account_id, property_id, quote_id, quote_version_id, kind, status, start_date, service_kind
) values (
  :'org'::uuid, :'acct_b'::uuid, :'prop_b'::uuid, :'q_b'::uuid, :'vid_b'::uuid,
  'recurring', 'active', :'month_start'::date, 'lawn'
) returning id as agr_b \gset

insert into public.jobs (org_id, agreement_id, property_id, quote_id, title, status)
values (:'org'::uuid, :'agr_a'::uuid, :'prop_a'::uuid, :'q_a'::uuid, 'Alpha mow', 'scheduled')
  returning id as job_a \gset
insert into public.jobs (org_id, agreement_id, property_id, quote_id, title, status)
values (:'org'::uuid, :'agr_b'::uuid, :'prop_b'::uuid, :'q_b'::uuid, 'Beta edge', 'scheduled')
  returning id as job_b \gset

insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr_a'::uuid, :'job_a'::uuid, :'prop_a'::uuid, 0, :'day_a'::date, :'day_a'::date, 'scheduled'
) returning id as visit_a \gset
insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status, skip_reason
) values (
  :'org'::uuid, :'agr_a'::uuid, :'job_a'::uuid, :'prop_a'::uuid, 1, :'day_b'::date, :'day_b'::date,
  'skipped', 'weather'
) returning id as visit_skip \gset
insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr_b'::uuid, :'job_b'::uuid, :'prop_b'::uuid, 0, :'day_c'::date, :'day_c'::date, 'scheduled'
) returning id as visit_b \gset
-- Photo-pending: completed without a server-side after photo (S14 shape).
insert into public.visits (
  org_id, agreement_id, job_id, property_id, sort, occurrence_date, scheduled_date, status
) values (
  :'org'::uuid, :'agr_a'::uuid, :'job_a'::uuid, :'prop_a'::uuid, 2, :'day_c'::date, :'day_c'::date, 'scheduled'
) returning id as visit_pending \gset

insert into public.visit_tasks (org_id, visit_id, label, source_line_item_id, sort) values
  (:'org'::uuid, :'visit_a'::uuid, 'Mow', :'line_mow'::uuid, 0),
  (:'org'::uuid, :'visit_a'::uuid, 'Aeration', :'line_aerate'::uuid, 1),
  (:'org'::uuid, :'visit_a'::uuid, 'Mulch upsell', :'line_mulch'::uuid, 2),
  (:'org'::uuid, :'visit_b'::uuid, 'Edge', :'line_edge'::uuid, 0),
  (:'org'::uuid, :'visit_pending'::uuid, 'Mow', :'line_mow'::uuid, 0);

select gen_random_uuid() as photo_a \gset
select gen_random_uuid() as photo_b \gset
insert into storage.objects (bucket_id, name)
values
  ('visit-photos', :'org' || '/' || :'visit_a' || '/' || :'photo_a' || '.jpg'),
  ('visit-photos', :'org' || '/' || :'visit_b' || '/' || :'photo_b' || '.jpg');
insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
values
  (
    :'org'::uuid, :'visit_a'::uuid, 'after',
    :'org' || '/' || :'visit_a' || '/' || :'photo_a' || '.jpg',
    now(), :'photo_a'::uuid
  ),
  (
    :'org'::uuid, :'visit_b'::uuid, 'after',
    :'org' || '/' || :'visit_b' || '/' || :'photo_b' || '.jpg',
    now(), :'photo_b'::uuid
  );

update public.visits
set status = 'completed', completed_at = now()
where id in (:'visit_a'::uuid, :'visit_b'::uuid);

alter table public.visits disable trigger visits_guard_status;
update public.visits
set status = 'completed', completed_at = now()
where id = :'visit_pending'::uuid;
alter table public.visits enable trigger visits_guard_status;

update public.visits set billing_hold = true where id = :'visit_b'::uuid;

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format(
    $$ select public.create_invoices_batch(%L::date, %L::date) $$,
    :'month_start', :'month_end'
  ),
  '42501',
  null,
  'crew cannot create invoices'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

-- With Beta held, only Alpha visit_a is billable (pending has no photo; skip not completed).
select public.create_invoices_batch(:'month_start'::date, :'month_end'::date) as batch1 \gset

select is((:'batch1')::jsonb->>'invoice_count', '1', 'first run creates one draft (Alpha only)');
select is((:'batch1')::jsonb->>'visit_count', '1', 'first run bills one visit');

select is(
  (select count(*)::int from public.invoices where org_id = :'org'::uuid and status = 'draft'),
  1,
  'exactly one draft invoice'
);
select is(
  (select account_id from public.invoices where org_id = :'org'::uuid),
  :'acct_a'::uuid,
  'draft belongs to Account Alpha'
);
-- Mow $80 + Aeration verified $90 capped at $100 = $170; mulch upsell excluded.
select is(
  (select total_cents from public.invoices where org_id = :'org'::uuid),
  17000::bigint,
  'Alpha draft total is mow + capped aeration'
);
select is(
  (
    select count(*)::int
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
    where i.org_id = :'org'::uuid
  ),
  2,
  'two billable lines; unaccepted upsell omitted'
);
select ok(
  (
    select bool_and(l.service_date is not null and l.property_id is not null and l.visit_id is not null)
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
    where i.org_id = :'org'::uuid
  ),
  'each line carries service date, property, and visit'
);

-- Release hold on Beta; pending still lacks photo.
select tests.clear_auth();
update public.visits set billing_hold = false where id = :'visit_b'::uuid;
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select public.create_invoices_batch(:'month_start'::date, :'month_end'::date) as batch2 \gset
select is((:'batch2')::jsonb->>'invoice_count', '1', 'second run drafts Beta only');
select is((:'batch2')::jsonb->>'visit_count', '1', 'second run bills Beta visit');

select is(
  (select count(*)::int from public.invoices where org_id = :'org'::uuid and status = 'draft'),
  2,
  'two accounts yield two drafts'
);
select is(
  (select total_cents from public.invoices where account_id = :'acct_b'::uuid),
  5000::bigint,
  'Beta draft total is $50'
);

-- Re-run: no new lines / visits.
select public.create_invoices_batch(:'month_start'::date, :'month_end'::date) as batch3 \gset
select is((:'batch3')::jsonb->>'invoice_count', '0', 'third run creates no invoices');
select is((:'batch3')::jsonb->>'visit_count', '0', 'third run bills no visits');
select is(
  (select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id where i.org_id = :'org'::uuid),
  3,
  're-run does not double-bill lines'
);

-- Photo arrives for pending visit → next run includes it on Alpha draft.
select tests.clear_auth();
select gen_random_uuid() as photo_p \gset
insert into storage.objects (bucket_id, name)
values ('visit-photos', :'org' || '/' || :'visit_pending' || '/' || :'photo_p' || '.jpg');
insert into public.visit_photos (org_id, visit_id, kind, storage_path, taken_at, client_id)
values (
  :'org'::uuid, :'visit_pending'::uuid, 'after',
  :'org' || '/' || :'visit_pending' || '/' || :'photo_p' || '.jpg',
  now(), :'photo_p'::uuid
);
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select public.create_invoices_batch(:'month_start'::date, :'month_end'::date) as batch4 \gset
select is((:'batch4')::jsonb->>'visit_count', '1', 'photo arrival bills the pending visit');
select is(
  (select total_cents from public.invoices where account_id = :'acct_a'::uuid),
  25000::bigint,
  'Alpha draft grows by the pending mow ($80)'
);

-- Never-made-up skip still bills nothing.
select is(
  (select billed_invoice_id is null from public.visits where id = :'visit_skip'::uuid),
  true,
  'skipped visit that was never made up stays unbilled'
);

select * from finish();
