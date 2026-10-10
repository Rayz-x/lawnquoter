-- I12: fixed seasonal installment agreements (season price ÷ months).
-- Spec: internal/tickets/is-wave2/I12_5b34.md / #79

select plan(18);

select ok(
  not has_function_privilege(
    'anon',
    'public.configure_seasonal_installments(uuid, bigint, integer, integer, date)',
    'execute'
  ),
  'anon has no execute on configure_seasonal_installments'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_installment_invoice(uuid, integer, integer)',
    'execute'
  ),
  'anon has no execute on create_installment_invoice'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.true_up_installment_agreement(uuid, date)',
    'execute'
  ),
  'anon has no execute on true_up_installment_agreement'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.set_agreement_season_price(uuid, bigint, date)',
    'execute'
  ),
  'anon has no execute on set_agreement_season_price'
);

select tests.create_user('inst-owner@example.com', 'Inst Owner') as owner \gset
select tests.create_user('inst-crew@example.com', 'Inst Crew') as crew \gset
select tests.create_org('Installment Co', 'installment-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

insert into public.accounts (org_id, name)
values (:'org'::uuid, 'Season Account')
returning id as acct \gset

insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '12 Season Ln', 'Springfield', 'IL', '62704')
returning id as prop \gset

-- Season $1,200 over 6 months → $200/mo. 24 expected visits → $50 each.
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow,
  start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', 1,
  '2026-04-01', 'active'
) returning id as agr \gset

insert into public.jobs (org_id, agreement_id, property_id, title)
values (:'org'::uuid, :'agr'::uuid, :'prop'::uuid, 'Season mow')
returning id as job \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select lives_ok(
  format(
    $$ select public.configure_seasonal_installments(%L, 120000, 6, 24, '2026-04-01') $$,
    :'agr'
  ),
  'owner can configure seasonal installments'
);

-- Skipped month still bills the installment ---------------------------------
select tests.clear_auth();
insert into public.visits (
  org_id, agreement_id, job_id, property_id, occurrence_date, scheduled_date,
  status, skip_reason, sort
) values (
  :'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid,
  '2026-05-05', '2026-05-05', 'skipped', 'weather', 0
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.create_installment_invoice(:'agr'::uuid, 2026, 5) as may_inv \gset

select is(
  (select source::text from public.invoices where id = :'may_inv'::uuid),
  'installment',
  'skipped month creates an installment invoice'
);
select is(
  (select total_cents from public.invoices where id = :'may_inv'::uuid),
  20000::bigint,
  'skipped month bills season_price / months'
);
select is(
  (
    select count(*)::integer
    from public.invoice_lines
    where invoice_id = :'may_inv'::uuid
  ),
  1,
  'installment invoice has one line'
);

-- Mid-month start is prorated -----------------------------------------------
select tests.clear_auth();
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow,
  start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', 1,
  '2026-06-15', 'active'
) returning id as agr_prorate \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.configure_seasonal_installments(
  :'agr_prorate'::uuid, 120000, 6, 24, '2026-06-15'
);

select public.create_installment_invoice(:'agr_prorate'::uuid, 2026, 6) as june_inv \gset

-- June 2026 has 30 days; active 15..30 → 16 days. 20000 * 16 / 30 = 10666.
select is(
  (select total_cents from public.invoices where id = :'june_inv'::uuid),
  10666::bigint,
  'mid-month start prorates the first installment'
);

-- Early end true-up: visits delivered vs paid -------------------------------
select tests.clear_auth();
insert into public.visits (
  org_id, agreement_id, job_id, property_id, occurrence_date, scheduled_date,
  status, sort
) values
  (:'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid,
   '2026-04-07', '2026-04-07', 'scheduled', 1),
  (:'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid,
   '2026-04-14', '2026-04-14', 'scheduled', 2),
  (:'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid,
   '2026-04-21', '2026-04-21', 'scheduled', 3),
  (:'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid,
   '2026-04-28', '2026-04-28', 'scheduled', 4),
  (:'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid,
   '2026-05-12', '2026-05-12', 'scheduled', 5),
  (:'org'::uuid, :'agr'::uuid, :'job'::uuid, :'prop'::uuid,
   '2026-05-19', '2026-05-19', 'scheduled', 6);

-- After photos (required to complete) then mark delivered.
create temporary table _inst_visit_photos on commit drop as
select
  id as visit_id,
  org_id,
  gen_random_uuid() as client_id,
  org_id::text || '/' || id::text || '/' || gen_random_uuid()::text || '.jpg' as storage_path
from public.visits
where agreement_id = :'agr'::uuid
  and status = 'scheduled'
  and occurrence_date between '2026-04-07' and '2026-05-19';

-- Rebuild paths so client_id matches the filename.
update _inst_visit_photos
set storage_path = org_id::text || '/' || visit_id::text || '/' || client_id::text || '.jpg';

insert into storage.objects (bucket_id, name)
select 'visit-photos', storage_path from _inst_visit_photos;

insert into public.visit_photos (
  org_id, visit_id, kind, storage_path, taken_at, client_id
)
select org_id, visit_id, 'after', storage_path, now(), client_id
from _inst_visit_photos;

update public.visits v
set status = 'completed', completed_at = v.occurrence_date + time '18:00'
from _inst_visit_photos p
where v.id = p.visit_id;

-- May already billed 20000. Six completed visits × (120000/24=5000) = 30000.
-- True-up owes 10000.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.true_up_installment_agreement(:'agr'::uuid, '2026-05-20') as true_up_inv \gset

select is(
  (select source::text from public.invoices where id = :'true_up_inv'::uuid),
  'true_up',
  'early end creates a true-up invoice'
);
select is(
  (select total_cents from public.invoices where id = :'true_up_inv'::uuid),
  10000::bigint,
  'true-up amount is visits delivered minus installments paid'
);
select is(
  (select status::text from public.agreements where id = :'agr'::uuid),
  'ended',
  'true-up ends the agreement'
);
select is(
  (select end_date from public.agreements where id = :'agr'::uuid),
  '2026-05-20'::date,
  'true-up sets agreement end_date'
);

select is(
  (
    select (public.agreement_installment_balance(:'agr'::uuid)->>'visits_delivered')::integer
  ),
  6,
  'balance reports visits delivered'
);
select is(
  (
    select (public.agreement_installment_balance(:'agr'::uuid)->>'delivered_cents')::bigint
  ),
  30000::bigint,
  'balance reports delivered cents'
);
select is(
  (
    select (public.agreement_installment_balance(:'agr'::uuid)->>'paid_cents')::bigint
  ),
  30000::bigint,
  'balance includes installment plus true-up as paid'
);

-- Price change applies from effective date only -----------------------------
select tests.clear_auth();
insert into public.agreements (
  org_id, account_id, property_id, kind, frequency, preferred_dow,
  start_date, status
) values (
  :'org'::uuid, :'acct'::uuid, :'prop'::uuid, 'recurring', 'weekly', 1,
  '2026-04-01', 'active'
) returning id as agr_price \gset

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select public.configure_seasonal_installments(
  :'agr_price'::uuid, 120000, 6, 24, '2026-04-01'
);
select public.create_installment_invoice(:'agr_price'::uuid, 2026, 4) as apr_inv \gset

-- Issue April so a later price change cannot rewrite it.
select tests.clear_auth();
select set_config('role', 'service_role', true) as ignored_role \gset
update public.invoices
set status = 'issued', issued_at = now(), number = 1
where id = :'apr_inv'::uuid;
select tests.clear_auth();
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select public.set_agreement_season_price(:'agr_price'::uuid, 180000, '2026-05-01');

select public.create_installment_invoice(:'agr_price'::uuid, 2026, 5) as may_new \gset

select is(
  (select total_cents from public.invoices where id = :'apr_inv'::uuid),
  20000::bigint,
  'effective-date price change does not alter past invoices'
);
select is(
  (select total_cents from public.invoices where id = :'may_new'::uuid),
  30000::bigint,
  'months on/after effective date use the new season price'
);

select * from finish();
