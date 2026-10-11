-- I09 (#76): refunds on charge.refunded; dispute flag + deadline; evidence pack columns.
-- Hosted apply requires Dusty's OK; this migration is not applied here.
-- Composes with I10 (payment_dispute_open on accounts) and I07 (Stripe payment writer).

-- ---------------------------------------------------------------------------
-- Invoice dispute flag (shows deadline for evidence)
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists payment_dispute_open boolean not null default false;

alter table public.invoices
  add column if not exists payment_dispute_deadline timestamptz;

alter table public.invoices
  add column if not exists stripe_dispute_id text;

comment on column public.invoices.payment_dispute_open is
  'I09: true while a Stripe dispute is open for a payment on this invoice.';
comment on column public.invoices.payment_dispute_deadline is
  'I09: Stripe evidence due_by when the dispute was opened.';
comment on column public.invoices.stripe_dispute_id is
  'I09: Stripe dispute id currently open on this invoice (cleared on dispute.closed).';

create unique index if not exists invoices_stripe_dispute_id_key
  on public.invoices (stripe_dispute_id)
  where stripe_dispute_id is not null;

-- ---------------------------------------------------------------------------
-- Account dispute pause (shared soft-dep with I10 reminders)
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column if not exists payment_dispute_open boolean not null default false;

comment on column public.accounts.payment_dispute_open is
  'I09/I10: when true, payment reminders are paused for this account.';

-- ---------------------------------------------------------------------------
-- Refund id on payments (status already includes refunded)
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists stripe_refund_id text;

create unique index if not exists payments_stripe_refund_id_key
  on public.payments (stripe_refund_id)
  where stripe_refund_id is not null;

create index if not exists payments_stripe_charge_id_idx
  on public.payments (stripe_charge_id)
  where stripe_charge_id is not null;
