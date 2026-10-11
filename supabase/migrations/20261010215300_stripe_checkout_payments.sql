-- I07: Stripe Checkout payment fields + public invoice token for Pay.
-- Webhook / service_role remains the only payment writer (audit A3).
-- Hosted apply requires Dusty's OK; this migration is not applied here.

-- ---------------------------------------------------------------------------
-- Public token for /i/[token] Pay (shared soft-dep with I05)
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists invoices_public_token_key
  on public.invoices (public_token);

-- ---------------------------------------------------------------------------
-- Stripe Checkout payment metadata (IDs + last4/brand only)
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists stripe_checkout_session_id text;

alter table public.payments
  add column if not exists card_brand text
    check (card_brand is null or length(btrim(card_brand)) between 1 and 32);

alter table public.payments
  add column if not exists card_last4 text
    check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');

create unique index if not exists payments_stripe_payment_intent_id_key
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists payments_stripe_checkout_session_id_key
  on public.payments (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- Failed ACH may reopen a paid invoice back to issued (clear paid_at).
-- ---------------------------------------------------------------------------
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
