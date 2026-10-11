-- I12: Fixed seasonal installment agreements (season price ÷ months).
-- Monthly installment regardless of skips, prorated first month, visits
-- delivered vs paid, true-up on early end, effective-dated price changes.

-- ---------------------------------------------------------------------------
-- Enums + agreement billing columns
-- ---------------------------------------------------------------------------
create type public.agreement_billing_mode as enum ('per_visit', 'seasonal_installment');

alter type public.invoice_source add value if not exists 'installment';
alter type public.invoice_source add value if not exists 'true_up';

alter table public.agreements
  add column billing_mode public.agreement_billing_mode not null default 'per_visit',
  add column season_months integer,
  add column expected_visits integer;

alter table public.agreements
  add constraint agreements_seasonal_fields check (
    (
      billing_mode = 'per_visit'
      and season_months is null
      and expected_visits is null
    )
    or (
      billing_mode = 'seasonal_installment'
      and season_months is not null
      and season_months between 1 and 24
      and expected_visits is not null
      and expected_visits >= 1
    )
  );

-- ---------------------------------------------------------------------------
-- Effective-dated season prices (past invoices stay frozen)
-- ---------------------------------------------------------------------------
create table public.agreement_price_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  season_price_cents bigint not null check (season_price_cents > 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  constraint agreement_price_terms_unique_effective
    unique (agreement_id, effective_from)
);

create index agreement_price_terms_agreement_idx
  on public.agreement_price_terms (agreement_id, effective_from desc);
create index agreement_price_terms_org_idx
  on public.agreement_price_terms (org_id);

create trigger agreement_price_terms_agreement_org
  before insert or update of org_id, agreement_id on public.agreement_price_terms
  for each row execute function private.child_org_guard('agreements', 'agreement_id');

alter table public.agreement_price_terms enable row level security;
alter table public.agreement_price_terms force row level security;

create policy agreement_price_terms_select on public.agreement_price_terms
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
create policy agreement_price_terms_insert on public.agreement_price_terms
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy agreement_price_terms_update on public.agreement_price_terms
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

grant select, insert, update on public.agreement_price_terms to authenticated;
grant all on public.agreement_price_terms to service_role;

-- Billing period (first day of month) for installment idempotency.
alter table public.invoices
  add column billing_period date;

create unique index invoices_agreement_installment_period_key
  on public.invoices (org_id, agreement_id, billing_period)
  where source = 'installment'
    and agreement_id is not null
    and billing_period is not null;

-- Keep billing_period locked once issued (extends I01 issued-invoice lock).
create or replace function private.invoices_issued_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.issued_at is null then
    return new;
  end if;

  -- Carry forward I04 (#145) lock fields plus installment identity.
  if new.subtotal_cents is distinct from old.subtotal_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.total_cents is distinct from old.total_cents
     or new.account_id is distinct from old.account_id
     or new.visit_id is distinct from old.visit_id
     or new.agreement_id is distinct from old.agreement_id
     or new.source is distinct from old.source
     or new.currency is distinct from old.currency
     or new.number is distinct from old.number
     or new.number_label is distinct from old.number_label
     or new.tax_rate_bps is distinct from old.tax_rate_bps
     or new.tax_label is distinct from old.tax_label
     or new.issued_at is distinct from old.issued_at
     or new.due_on is distinct from old.due_on
     or new.billing_period is distinct from old.billing_period
  then
    raise exception 'issued invoice totals and identity are locked'
      using errcode = '55000';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'issued' and new.status in ('paid', 'void'))
      or (old.status = 'paid' and new.status = 'paid')
    ) then
      raise exception 'issued invoice may only move to paid or void'
        using errcode = '55000';
    end if;

    if new.status = 'void' then
      if exists (
        select 1 from public.payments p where p.invoice_id = old.id
      ) then
        raise exception 'cannot void an invoice that has payments'
          using errcode = '55000';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.season_price_as_of(
  p_agreement_id uuid,
  p_as_of date
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select t.season_price_cents
  from public.agreement_price_terms t
  where t.agreement_id = p_agreement_id
    and t.effective_from <= p_as_of
  order by t.effective_from desc
  limit 1;
$$;

revoke all on function private.season_price_as_of(uuid, date) from public, anon;
grant execute on function private.season_price_as_of(uuid, date) to authenticated, service_role;

create or replace function private.monthly_installment_cents(
  p_season_price_cents bigint,
  p_season_months integer
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select (p_season_price_cents / p_season_months)::bigint;
$$;

revoke all on function private.monthly_installment_cents(bigint, integer) from public, anon;
grant execute on function private.monthly_installment_cents(bigint, integer) to authenticated, service_role;

create or replace function private.prorate_installment_cents(
  p_monthly_cents bigint,
  p_period_start date,
  p_active_from date
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_days_in_month integer;
  v_active_from date;
  v_days_active integer;
begin
  if p_active_from is null or p_active_from <= p_period_start then
    return p_monthly_cents;
  end if;

  v_days_in_month := extract(
    day from (date_trunc('month', p_period_start) + interval '1 month - 1 day')
  )::integer;

  v_active_from := p_active_from;
  if v_active_from > (p_period_start + (v_days_in_month - 1)) then
    return 0;
  end if;

  v_days_active := v_days_in_month - extract(day from v_active_from)::integer + 1;
  return (p_monthly_cents * v_days_active) / v_days_in_month;
end;
$$;

revoke all on function private.prorate_installment_cents(bigint, date, date) from public, anon;
grant execute on function private.prorate_installment_cents(bigint, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------
create or replace function public.configure_seasonal_installments(
  p_agreement_id uuid,
  p_season_price_cents bigint,
  p_season_months integer,
  p_expected_visits integer,
  p_effective_from date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_from date;
begin
  select * into a
  from public.agreements
  where id = p_agreement_id
  for update;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status = 'ended' then
    raise exception 'ended agreements cannot be configured' using errcode = '22023';
  end if;
  if p_season_price_cents is null or p_season_price_cents <= 0 then
    raise exception 'season price must be positive' using errcode = '22023';
  end if;
  if p_season_months is null or p_season_months < 1 or p_season_months > 24 then
    raise exception 'season months must be between 1 and 24' using errcode = '22023';
  end if;
  if p_expected_visits is null or p_expected_visits < 1 then
    raise exception 'expected visits must be at least 1' using errcode = '22023';
  end if;

  v_from := coalesce(p_effective_from, a.start_date);

  update public.agreements
  set
    billing_mode = 'seasonal_installment',
    season_months = p_season_months,
    expected_visits = p_expected_visits
  where id = a.id;

  insert into public.agreement_price_terms (
    org_id, agreement_id, season_price_cents, effective_from
  ) values (
    a.org_id, a.id, p_season_price_cents, v_from
  )
  on conflict (agreement_id, effective_from) do update
  set season_price_cents = excluded.season_price_cents;
end;
$$;

revoke all on function public.configure_seasonal_installments(uuid, bigint, integer, integer, date)
  from public, anon;
grant execute on function public.configure_seasonal_installments(uuid, bigint, integer, integer, date)
  to authenticated, service_role;

create or replace function public.set_agreement_season_price(
  p_agreement_id uuid,
  p_season_price_cents bigint,
  p_effective_from date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
begin
  select * into a
  from public.agreements
  where id = p_agreement_id
  for update;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.billing_mode is distinct from 'seasonal_installment' then
    raise exception 'agreement is not on seasonal installments' using errcode = '22023';
  end if;
  if p_season_price_cents is null or p_season_price_cents <= 0 then
    raise exception 'season price must be positive' using errcode = '22023';
  end if;
  if p_effective_from is null then
    raise exception 'effective_from is required' using errcode = '22023';
  end if;

  insert into public.agreement_price_terms (
    org_id, agreement_id, season_price_cents, effective_from
  ) values (
    a.org_id, a.id, p_season_price_cents, p_effective_from
  )
  on conflict (agreement_id, effective_from) do update
  set season_price_cents = excluded.season_price_cents;
end;
$$;

revoke all on function public.set_agreement_season_price(uuid, bigint, date) from public, anon;
grant execute on function public.set_agreement_season_price(uuid, bigint, date)
  to authenticated, service_role;

create or replace function public.create_installment_invoice(
  p_agreement_id uuid,
  p_year integer,
  p_month integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_period date;
  v_existing uuid;
  v_price bigint;
  v_monthly bigint;
  v_amount bigint;
  v_invoice uuid;
  v_label text;
begin
  select * into a
  from public.agreements
  where id = p_agreement_id
  for update;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.billing_mode is distinct from 'seasonal_installment' then
    raise exception 'agreement is not on seasonal installments' using errcode = '22023';
  end if;
  if p_year is null or p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'invalid billing period' using errcode = '22023';
  end if;

  v_period := make_date(p_year, p_month, 1);

  if a.end_date is not null and v_period > a.end_date then
    raise exception 'billing period is after agreement end' using errcode = '22023';
  end if;
  if v_period + interval '1 month - 1 day' < a.start_date then
    raise exception 'billing period is before agreement start' using errcode = '22023';
  end if;

  select i.id into v_existing
  from public.invoices i
  where i.org_id = a.org_id
    and i.agreement_id = a.id
    and i.source = 'installment'
    and i.billing_period = v_period;

  if v_existing is not null then
    return v_existing;
  end if;

  -- Price as of the first active day in the period (mid-month starts use
  -- start_date, not the 1st, so a term effective on start_date applies).
  v_price := private.season_price_as_of(a.id, greatest(v_period, a.start_date));
  if v_price is null then
    raise exception 'no season price effective for period' using errcode = 'P0002';
  end if;

  v_monthly := private.monthly_installment_cents(v_price, a.season_months);
  v_amount := private.prorate_installment_cents(v_monthly, v_period, a.start_date);

  if v_amount <= 0 then
    raise exception 'installment amount is zero for period' using errcode = '22023';
  end if;

  v_label := format(
    'Seasonal installment %s %s',
    trim(to_char(v_period, 'Month')),
    p_year
  );

  insert into public.invoices (
    org_id,
    account_id,
    property_id,
    agreement_id,
    status,
    source,
    currency,
    subtotal_cents,
    tax_cents,
    total_cents,
    billing_period,
    notes
  ) values (
    a.org_id,
    a.account_id,
    a.property_id,
    a.id,
    'draft',
    'installment',
    'usd',
    v_amount,
    0,
    v_amount,
    v_period,
    'Billed regardless of visits completed or skipped'
  ) returning id into v_invoice;

  insert into public.invoice_lines (
    org_id,
    invoice_id,
    description,
    quantity,
    unit_price_cents,
    amount_cents,
    sort
  ) values (
    a.org_id,
    v_invoice,
    v_label,
    1,
    v_amount,
    v_amount,
    0
  );

  return v_invoice;
end;
$$;

revoke all on function public.create_installment_invoice(uuid, integer, integer) from public, anon;
grant execute on function public.create_installment_invoice(uuid, integer, integer)
  to authenticated, service_role;

create or replace function public.agreement_installment_balance(p_agreement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_as_of date;
  v_price bigint;
  v_visit_cents bigint;
  v_delivered integer;
  v_delivered_cents bigint;
  v_paid_cents bigint;
begin
  select * into a
  from public.agreements
  where id = p_agreement_id;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_read_pricing(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.billing_mode is distinct from 'seasonal_installment' then
    raise exception 'agreement is not on seasonal installments' using errcode = '22023';
  end if;

  v_as_of := coalesce(a.end_date, private.org_local_today(a.org_id));
  v_price := private.season_price_as_of(a.id, v_as_of);
  if v_price is null then
    raise exception 'no season price on agreement' using errcode = 'P0002';
  end if;

  v_visit_cents := v_price / a.expected_visits;

  select count(*)::integer into v_delivered
  from public.visits v
  where v.agreement_id = a.id
    and v.status = 'completed'
    and (a.end_date is null or v.occurrence_date <= a.end_date);

  v_delivered_cents := v_delivered::bigint * v_visit_cents;

  select coalesce(sum(i.total_cents), 0)::bigint into v_paid_cents
  from public.invoices i
  where i.agreement_id = a.id
    and i.status <> 'void'
    and i.source in ('installment', 'true_up');

  return jsonb_build_object(
    'visits_delivered', v_delivered,
    'visit_value_cents', v_visit_cents,
    'delivered_cents', v_delivered_cents,
    'paid_cents', v_paid_cents,
    'balance_cents', v_delivered_cents - v_paid_cents
  );
end;
$$;

revoke all on function public.agreement_installment_balance(uuid) from public, anon;
grant execute on function public.agreement_installment_balance(uuid)
  to authenticated, service_role;

create or replace function public.true_up_installment_agreement(
  p_agreement_id uuid,
  p_as_of date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_price bigint;
  v_visit_cents bigint;
  v_delivered integer;
  v_delivered_cents bigint;
  v_paid_cents bigint;
  v_true_up bigint;
  v_invoice uuid;
  v_existing uuid;
begin
  select * into a
  from public.agreements
  where id = p_agreement_id
  for update;

  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.billing_mode is distinct from 'seasonal_installment' then
    raise exception 'agreement is not on seasonal installments' using errcode = '22023';
  end if;
  if p_as_of is null then
    raise exception 'as_of date is required' using errcode = '22023';
  end if;
  if p_as_of < a.start_date then
    raise exception 'as_of is before agreement start' using errcode = '22023';
  end if;

  select i.id into v_existing
  from public.invoices i
  where i.agreement_id = a.id
    and i.source = 'true_up'
    and i.status <> 'void'
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  v_price := private.season_price_as_of(a.id, p_as_of);
  if v_price is null then
    raise exception 'no season price effective for true-up' using errcode = 'P0002';
  end if;

  v_visit_cents := v_price / a.expected_visits;

  select count(*)::integer into v_delivered
  from public.visits v
  where v.agreement_id = a.id
    and v.status = 'completed'
    and v.occurrence_date <= p_as_of;

  v_delivered_cents := v_delivered::bigint * v_visit_cents;

  select coalesce(sum(i.total_cents), 0)::bigint into v_paid_cents
  from public.invoices i
  where i.agreement_id = a.id
    and i.status <> 'void'
    and i.source = 'installment';

  v_true_up := v_delivered_cents - v_paid_cents;

  update public.agreements
  set status = 'ended', end_date = p_as_of
  where id = a.id;

  if v_true_up = 0 then
    return null;
  end if;

  if v_true_up < 0 then
    insert into public.credit_notes (
      org_id, account_id, amount_cents, currency, reason
    ) values (
      a.org_id,
      a.account_id,
      abs(v_true_up),
      'usd',
      format('Seasonal installment true-up credit as of %s', p_as_of)
    );
    return null;
  end if;

  insert into public.invoices (
    org_id,
    account_id,
    property_id,
    agreement_id,
    status,
    source,
    currency,
    subtotal_cents,
    tax_cents,
    total_cents,
    notes
  ) values (
    a.org_id,
    a.account_id,
    a.property_id,
    a.id,
    'draft',
    'true_up',
    'usd',
    v_true_up,
    0,
    v_true_up,
    format('True-up for early end on %s (visits delivered vs paid)', p_as_of)
  ) returning id into v_invoice;

  insert into public.invoice_lines (
    org_id,
    invoice_id,
    description,
    quantity,
    unit_price_cents,
    amount_cents,
    sort
  ) values (
    a.org_id,
    v_invoice,
    format('Seasonal true-up as of %s', p_as_of),
    1,
    v_true_up,
    v_true_up,
    0
  );

  return v_invoice;
end;
$$;

revoke all on function public.true_up_installment_agreement(uuid, date) from public, anon;
grant execute on function public.true_up_installment_agreement(uuid, date)
  to authenticated, service_role;
