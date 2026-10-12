-- Deposit invoice at quote acceptance. quote_id is locked once the invoice is issued.
-- The function is service_role only. Click-to-accept still works with Stripe unset.

alter table public.invoices
  add column if not exists quote_id uuid references public.quotes(id) on delete set null;

create index if not exists invoices_quote_id_idx on public.invoices (quote_id);

create unique index if not exists invoices_quote_deposit_key
  on public.invoices (quote_id)
  where source = 'deposit' and quote_id is not null;

drop trigger if exists invoices_quote_org on public.invoices;
create trigger invoices_quote_org
  before insert or update of org_id, quote_id on public.invoices
  for each row execute function private.child_org_guard('quotes', 'quote_id');

-- Latest lock is 20261010215300_stripe_checkout_payments.sql, plus quote_id.
create or replace function private.invoices_issued_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.issued_at is null then
    return new;
  end if;

  if new.subtotal_cents is distinct from old.subtotal_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.total_cents is distinct from old.total_cents
     or new.account_id is distinct from old.account_id
     or new.visit_id is distinct from old.visit_id
     or new.source is distinct from old.source
     or new.currency is distinct from old.currency
     or new.number is distinct from old.number
     or new.number_label is distinct from old.number_label
     or new.tax_rate_bps is distinct from old.tax_rate_bps
     or new.tax_label is distinct from old.tax_label
     or new.issued_at is distinct from old.issued_at
     or new.due_on is distinct from old.due_on
     or new.public_token is distinct from old.public_token
     or new.quote_id is distinct from old.quote_id
  then
    raise exception 'issued invoice totals and identity are locked'
      using errcode = '55000';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'issued' and new.status in ('paid', 'void'))
      or (old.status = 'paid' and new.status in ('paid', 'issued'))
    ) then
      raise exception 'issued invoice may only move to paid, void, or reopen to issued'
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

create or replace function public.create_deposit_invoice(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes;
  v_org public.orgs;
  v_existing uuid;
  v_id uuid;
  v_cents bigint;
  v_number integer;
  v_issued timestamptz := now();
  v_date date;
begin
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  v_cents := round(coalesce(v_quote.deposit_amount, 0) * 100)::bigint;
  if v_cents <= 0 then
    return null;
  end if;

  select id into v_existing
  from public.invoices
  where quote_id = v_quote.id and source = 'deposit'
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_org from public.orgs where id = v_quote.org_id;
  v_number := private.allocate_invoice_number(v_quote.org_id);
  v_date := (timezone(v_org.timezone, v_issued))::date;

  insert into public.invoices (
    org_id, account_id, property_id, quote_id, number, number_label,
    status, source, currency, subtotal_cents, tax_cents, total_cents,
    issued_at, due_on, tax_rate_bps, tax_label
  ) values (
    v_quote.org_id, v_quote.account_id, v_quote.property_id, v_quote.id,
    v_number,
    'INV-' || to_char(v_date, 'YYYY') || '-' || lpad(v_number::text, 4, '0'),
    'issued', 'deposit', 'usd', v_cents, 0, v_cents,
    v_issued, v_date, 0, 'Tax: $0.00 (services to real property, TN)'
  ) returning id into v_id;

  insert into public.invoice_lines (
    org_id, invoice_id, description, quantity, unit_price_cents, amount_cents, taxable, tax_cents
  ) values (
    v_quote.org_id, v_id, 'Deposit for quote ' || v_quote.number::text,
    1, v_cents, v_cents, false, 0
  );

  return v_id;
end;
$$;

revoke all on function public.create_deposit_invoice(uuid) from public, anon, authenticated;
grant execute on function public.create_deposit_invoice(uuid) to service_role;
