-- Level billing: the season price is split into equal monthly drafts.
-- Remainder cents land on the last month so the invoices sum to the season price.

alter table public.agreements
  add column if not exists billing_months integer;

alter table public.agreements drop constraint if exists agreements_seasonal_fields;
alter table public.agreements
  add constraint agreements_seasonal_fields check (
    (
      billing_mode = 'per_visit'
      and season_months is null
      and expected_visits is null
      and billing_months is null
    )
    or (
      billing_mode = 'seasonal_installment'
      and season_months is not null
      and season_months between 1 and 24
      and expected_visits is not null
      and expected_visits >= 1
      and billing_months is null
    )
    or (
      billing_mode = 'level'
      and billing_months is not null
      and billing_months between 1 and 24
      and season_months is null
      and expected_visits is null
    )
  );

create unique index if not exists invoices_agreement_level_period_key
  on public.invoices (org_id, agreement_id, billing_period)
  where source = 'level'
    and agreement_id is not null
    and billing_period is not null;

create or replace function public.configure_level_billing(
  p_agreement_id uuid,
  p_season_price_cents bigint,
  p_billing_months integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agreements;
  v_offset integer;
  v_period date;
begin
  if p_season_price_cents is null or p_season_price_cents <= 0 then
    raise exception 'season price is required' using errcode = '22023';
  end if;
  if p_billing_months is null or p_billing_months < 1 or p_billing_months > 24 then
    raise exception 'billing months must be 1 to 24' using errcode = '22023';
  end if;

  select * into a from public.agreements where id = p_agreement_id for update;
  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.invoices i
    where i.agreement_id = a.id
      and i.source = 'level'
      and i.status <> 'draft'
  ) then
    raise exception 'level invoices already issued' using errcode = '22023';
  end if;

  update public.agreements
  set billing_mode = 'level',
      billing_months = p_billing_months,
      season_months = null,
      expected_visits = null
  where id = a.id;

  insert into public.agreement_price_terms (org_id, agreement_id, season_price_cents, effective_from)
  values (a.org_id, a.id, p_season_price_cents, a.start_date)
  on conflict (agreement_id, effective_from)
  do update set season_price_cents = excluded.season_price_cents;

  delete from public.invoices
  where agreement_id = a.id
    and source = 'level'
    and status = 'draft';

  -- One draft per month from the start month. Months after end_date are skipped.
  for v_offset in 0 .. p_billing_months - 1 loop
    v_period := (
      make_date(extract(year from a.start_date)::integer, extract(month from a.start_date)::integer, 1)
      + make_interval(months => v_offset)
    )::date;
    exit when a.end_date is not null and v_period > a.end_date;
    perform public.create_level_invoice(
      a.id,
      extract(year from v_period)::integer,
      extract(month from v_period)::integer
    );
  end loop;
end;
$$;

revoke all on function public.configure_level_billing(uuid, bigint, integer) from public, anon;
grant execute on function public.configure_level_billing(uuid, bigint, integer) to authenticated, service_role;

create or replace function public.create_level_invoice(
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
  v_index integer;
  v_base bigint;
  v_amount bigint;
  v_invoice uuid;
begin
  select * into a from public.agreements where id = p_agreement_id for update;
  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.billing_mode is distinct from 'level' or a.billing_months is null then
    raise exception 'agreement is not on level billing' using errcode = '22023';
  end if;
  if p_month is null or p_month < 1 or p_month > 12 or p_year is null then
    raise exception 'invalid billing period' using errcode = '22023';
  end if;

  v_period := make_date(p_year, p_month, 1);
  v_index := (p_year * 12 + p_month)
    - (extract(year from a.start_date)::integer * 12 + extract(month from a.start_date)::integer)
    + 1;
  if v_index < 1 or v_index > a.billing_months then
    raise exception 'billing period is outside level billing' using errcode = '22023';
  end if;
  if v_period + interval '1 month - 1 day' < a.start_date then
    raise exception 'billing period is before agreement start' using errcode = '22023';
  end if;
  if a.end_date is not null and v_period > a.end_date then
    raise exception 'billing period is after agreement end' using errcode = '22023';
  end if;

  select i.id into v_existing
  from public.invoices i
  where i.agreement_id = a.id and i.source = 'level' and i.billing_period = v_period;
  if v_existing is not null then
    return v_existing;
  end if;

  -- One season price for the whole plan, so months sum even when created out of order.
  v_price := private.season_price_as_of(a.id, a.start_date);
  if v_price is null then
    raise exception 'no season price effective for period' using errcode = 'P0002';
  end if;

  v_base := v_price / a.billing_months;
  if v_index = a.billing_months then
    v_amount := v_price - v_base * (a.billing_months - 1);
  else
    v_amount := v_base;
  end if;

  insert into public.invoices (
    org_id, account_id, property_id, agreement_id, status, source, currency,
    subtotal_cents, tax_cents, total_cents, billing_period, notes
  ) values (
    a.org_id, a.account_id, a.property_id, a.id, 'draft', 'level', 'usd',
    v_amount, 0, v_amount, v_period, 'Level billing. The same amount each month.'
  ) returning id into v_invoice;

  insert into public.invoice_lines (
    org_id, invoice_id, description, quantity, unit_price_cents, amount_cents, sort
  ) values (
    a.org_id, v_invoice,
    'Level billing ' || trim(to_char(v_period, 'Month')) || ' ' || p_year::text,
    1, v_amount, v_amount, 0
  );

  return v_invoice;
end;
$$;

revoke all on function public.create_level_invoice(uuid, integer, integer) from public, anon;
grant execute on function public.create_level_invoice(uuid, integer, integer) to authenticated, service_role;
