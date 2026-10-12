-- Late fees are their own draft invoices. Issued totals stay locked.
-- One non-void late fee per source invoice per calendar month.

alter table public.orgs
  add column if not exists late_fee_flat_cents integer not null default 0
    check (late_fee_flat_cents >= 0);

alter table public.orgs
  add column if not exists late_fee_bps integer not null default 0
    check (late_fee_bps >= 0 and late_fee_bps <= 10000);

alter table public.orgs
  add column if not exists late_fee_grace_days integer not null default 0
    check (late_fee_grace_days >= 0 and late_fee_grace_days <= 365);

alter table public.invoices
  add column if not exists fee_for_invoice_id uuid references public.invoices(id) on delete restrict;

drop trigger if exists invoices_fee_for_org on public.invoices;
create trigger invoices_fee_for_org
  before insert or update of org_id, fee_for_invoice_id on public.invoices
  for each row execute function private.child_org_guard('invoices', 'fee_for_invoice_id');

create unique index if not exists invoices_late_fee_period_key
  on public.invoices (org_id, fee_for_invoice_id, billing_period)
  where source = 'late_fee'
    and status <> 'void'
    and fee_for_invoice_id is not null
    and billing_period is not null;

create or replace function public.apply_late_fees()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_org_row public.orgs;
  v_today date;
  v_period date;
  v_src public.invoices;
  v_paid bigint;
  v_balance bigint;
  v_fee bigint;
  v_created integer := 0;
begin
  if v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_org_row from public.orgs where id = v_org;
  if v_org_row.late_fee_flat_cents = 0 and v_org_row.late_fee_bps = 0 then
    return 0;
  end if;

  v_today := (timezone(v_org_row.timezone, now()))::date;
  v_period := date_trunc('month', v_today::timestamp)::date;

  for v_src in
    select * from public.invoices i
    where i.org_id = v_org
      and i.status = 'issued'
      and i.due_on is not null
      and (v_today - i.due_on) > v_org_row.late_fee_grace_days
    order by i.due_on, i.id
    for update
  loop
    if exists (
      select 1 from public.invoices fee
      where fee.fee_for_invoice_id = v_src.id
        and fee.source = 'late_fee'
        and fee.billing_period = v_period
        and fee.status <> 'void'
    ) then
      continue;
    end if;

    select coalesce(sum(p.amount_cents), 0) into v_paid
    from public.payments p
    where p.invoice_id = v_src.id
      and p.status = 'succeeded';
    v_balance := v_src.total_cents - v_paid;
    if v_balance <= 0 then
      continue;
    end if;

    v_fee := v_org_row.late_fee_flat_cents + round(v_balance * v_org_row.late_fee_bps / 10000.0)::bigint;
    if v_fee <= 0 then
      continue;
    end if;

    insert into public.invoices (
      org_id, account_id, property_id, status, source, currency,
      subtotal_cents, tax_cents, total_cents, billing_period, fee_for_invoice_id, due_on, notes
    ) values (
      v_org, v_src.account_id, v_src.property_id, 'draft', 'late_fee', 'usd',
      v_fee, 0, v_fee, v_period, v_src.id, v_today,
      'Late fee. The original invoice total is unchanged.'
    );

    insert into public.invoice_lines (
      org_id, invoice_id, description, quantity, unit_price_cents, amount_cents, sort
    )
    select
      v_org, i.id,
      'Late fee for ' || coalesce(v_src.number_label, 'the open invoice'),
      1, v_fee, v_fee, 0
    from public.invoices i
    where i.fee_for_invoice_id = v_src.id
      and i.source = 'late_fee'
      and i.billing_period = v_period
      and i.status = 'draft'
    order by i.created_at desc
    limit 1;

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.apply_late_fees() from public, anon;
grant execute on function public.apply_late_fees() to authenticated, service_role;
