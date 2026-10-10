-- I01 billing ledger + audit A3 payment write lockdown.
-- Integer cents, issued-invoice lock, visit billed-once, unique Stripe event id.
-- Staff have no insert/update on payments. Crew roles cannot read billing tables.

-- Same-org child guards. Keep every parent table from main's latest
-- definition (20261009190000_jobs_scheduling_schema.sql), then add
-- visit_tasks / invoices / payments for this ledger.
create or replace function private.assert_same_org(p_table text, p_id text, p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  if p_id is null or p_id = '' then
    return;
  end if;
  if p_table not in (
    -- main (jobs scheduling) allowlist — do not drop any of these
    'accounts', 'properties', 'measurements', 'quotes', 'quote_versions',
    'quote_sections', 'quote_line_items', 'services', 'price_lists',
    'agreements', 'jobs', 'crews', 'routes', 'visits',
    -- billing ledger additions
    'visit_tasks', 'invoices', 'payments'
  ) then
    raise exception 'unsupported parent table %', p_table using errcode = '0A000';
  end if;

  execute format(
    'select exists (select 1 from public.%I where id = $1::uuid and org_id = $2)',
    p_table
  ) into ok using p_id, p_org;

  if not coalesce(ok, false) then
    raise exception '% must belong to the same org', p_table using errcode = '23503';
  end if;
end;
$$;

revoke all on function private.assert_same_org(text, text, uuid) from public;
grant execute on function private.assert_same_org(text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.invoice_status as enum ('draft', 'issued', 'paid', 'void');
create type public.invoice_source as enum (
  'visit', 'manual', 'progress', 'consolidated', 'deposit'
);
create type public.ledger_payment_status as enum (
  'pending', 'succeeded', 'failed', 'refunded'
);

-- ---------------------------------------------------------------------------
-- Per-company invoice counter
-- ---------------------------------------------------------------------------
create table public.invoice_counters (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  next_number integer not null default 1 check (next_number >= 1),
  updated_at timestamptz not null default now()
);

create trigger invoice_counters_set_updated_at
  before update on public.invoice_counters
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Invoices + snapshot lines
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  property_id uuid references public.properties(id) on delete set null,
  visit_id uuid references public.visits(id) on delete set null,
  agreement_id uuid references public.agreements(id) on delete set null,
  number integer check (number is null or number >= 1),
  status public.invoice_status not null default 'draft',
  source public.invoice_source not null default 'manual',
  currency text not null default 'usd' check (length(btrim(currency)) = 3),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  issued_at timestamptz,
  due_on date,
  paid_at timestamptz,
  voided_at timestamptz,
  po_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_issued_requires_at check (
    (status = 'draft' and issued_at is null)
    or (status <> 'draft' and issued_at is not null)
  ),
  constraint invoices_voided_at check (
    (status = 'void' and voided_at is not null)
    or (status <> 'void' and voided_at is null)
  ),
  constraint invoices_paid_at check (
    (status = 'paid' and paid_at is not null)
    or (status <> 'paid' and paid_at is null)
  )
);

create index invoices_org_status_idx on public.invoices (org_id, status);
create index invoices_account_id_idx on public.invoices (account_id);
create index invoices_visit_id_idx on public.invoices (visit_id);

create unique index invoices_org_number_key
  on public.invoices (org_id, number)
  where number is not null;

-- One invoice per visit (billed-once).
create unique index invoices_org_visit_key
  on public.invoices (org_id, visit_id)
  where visit_id is not null;

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function private.set_updated_at();

create trigger invoices_account_org
  before insert or update of org_id, account_id on public.invoices
  for each row execute function private.child_org_guard('accounts', 'account_id');
create trigger invoices_property_org
  before insert or update of org_id, property_id on public.invoices
  for each row execute function private.child_org_guard('properties', 'property_id');
create trigger invoices_visit_org
  before insert or update of org_id, visit_id on public.invoices
  for each row execute function private.child_org_guard('visits', 'visit_id');
create trigger invoices_agreement_org
  before insert or update of org_id, agreement_id on public.invoices
  for each row execute function private.child_org_guard('agreements', 'agreement_id');

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null check (length(btrim(description)) between 1 and 400),
  quantity numeric(12, 3) not null default 1 check (quantity >= 0),
  unit_price_cents bigint not null default 0,
  amount_cents bigint not null default 0,
  sort integer not null default 0,
  source_visit_task_id uuid references public.visit_tasks(id) on delete set null,
  source_line_item_id uuid references public.quote_line_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index invoice_lines_invoice_id_idx on public.invoice_lines (invoice_id);
create index invoice_lines_org_id_idx on public.invoice_lines (org_id);

create trigger invoice_lines_invoice_org
  before insert or update of org_id, invoice_id on public.invoice_lines
  for each row execute function private.child_org_guard('invoices', 'invoice_id');
create trigger invoice_lines_visit_task_org
  before insert or update of org_id, source_visit_task_id on public.invoice_lines
  for each row execute function private.child_org_guard('visit_tasks', 'source_visit_task_id');
create trigger invoice_lines_line_item_org
  before insert or update of org_id, source_line_item_id on public.invoice_lines
  for each row execute function private.child_org_guard('quote_line_items', 'source_line_item_id');

-- ---------------------------------------------------------------------------
-- Payments (webhook / service_role writes only — audit A3)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'usd' check (length(btrim(currency)) = 3),
  status public.ledger_payment_status not null default 'pending',
  stripe_payment_intent_id text,
  stripe_charge_id text,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_org_id_idx on public.payments (org_id);
create index payments_invoice_id_idx on public.payments (invoice_id);
create index payments_account_id_idx on public.payments (account_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

create trigger payments_account_org
  before insert or update of org_id, account_id on public.payments
  for each row execute function private.child_org_guard('accounts', 'account_id');
create trigger payments_invoice_org
  before insert or update of org_id, invoice_id on public.payments
  for each row execute function private.child_org_guard('invoices', 'invoice_id');

-- ---------------------------------------------------------------------------
-- Credit notes + account credits
-- ---------------------------------------------------------------------------
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'usd' check (length(btrim(currency)) = 3),
  reason text,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index credit_notes_org_id_idx on public.credit_notes (org_id);
create index credit_notes_account_id_idx on public.credit_notes (account_id);

create trigger credit_notes_account_org
  before insert or update of org_id, account_id on public.credit_notes
  for each row execute function private.child_org_guard('accounts', 'account_id');
create trigger credit_notes_invoice_org
  before insert or update of org_id, invoice_id on public.credit_notes
  for each row execute function private.child_org_guard('invoices', 'invoice_id');

create table public.account_credits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  currency text not null default 'usd' check (length(btrim(currency)) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, account_id, currency)
);

create index account_credits_account_id_idx on public.account_credits (account_id);

create trigger account_credits_set_updated_at
  before update on public.account_credits
  for each row execute function private.set_updated_at();

create trigger account_credits_account_org
  before insert or update of org_id, account_id on public.account_credits
  for each row execute function private.child_org_guard('accounts', 'account_id');

-- ---------------------------------------------------------------------------
-- Append-only billing events + Stripe event inbox
-- ---------------------------------------------------------------------------
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  kind text not null check (length(btrim(kind)) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index billing_events_org_id_idx on public.billing_events (org_id);
create index billing_events_invoice_id_idx on public.billing_events (invoice_id);

create trigger billing_events_invoice_org
  before insert or update of org_id, invoice_id on public.billing_events
  for each row execute function private.child_org_guard('invoices', 'invoice_id');
create trigger billing_events_payment_org
  before insert or update of org_id, payment_id on public.billing_events
  for each row execute function private.child_org_guard('payments', 'payment_id');

create table public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete set null,
  stripe_event_id text not null,
  event_type text not null check (length(btrim(event_type)) between 1 and 120),
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint stripe_events_event_id_unique unique (stripe_event_id)
);

create index stripe_events_org_id_idx on public.stripe_events (org_id);

-- ---------------------------------------------------------------------------
-- Issued-invoice lock + append-only billing events
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
     or new.issued_at is distinct from old.issued_at
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

create trigger invoices_issued_lock
  before update on public.invoices
  for each row execute function private.invoices_issued_lock();

create or replace function private.invoice_lines_issued_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  if exists (
    select 1 from public.invoices i
    where i.id = v_invoice and i.issued_at is not null
  ) then
    raise exception 'issued invoice lines are locked' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger invoice_lines_issued_lock
  before insert or update or delete on public.invoice_lines
  for each row execute function private.invoice_lines_issued_lock();

create or replace function private.billing_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'billing events are append-only' using errcode = '42501';
end;
$$;

create trigger billing_events_append_only
  before update or delete on public.billing_events
  for each row execute function private.billing_events_append_only();

revoke all on function private.invoices_issued_lock() from public, anon;
revoke all on function private.invoice_lines_issued_lock() from public, anon;
revoke all on function private.billing_events_append_only() from public, anon;
grant execute on function private.invoices_issued_lock() to authenticated, service_role;
grant execute on function private.invoice_lines_issued_lock() to authenticated, service_role;
grant execute on function private.billing_events_append_only() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: office reads via can_read_pricing; crew denied. Payments: no staff writes.
-- ---------------------------------------------------------------------------
alter table public.invoice_counters enable row level security;
alter table public.invoice_counters force row level security;
alter table public.invoices enable row level security;
alter table public.invoices force row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_lines force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_notes force row level security;
alter table public.account_credits enable row level security;
alter table public.account_credits force row level security;
alter table public.billing_events enable row level security;
alter table public.billing_events force row level security;
alter table public.stripe_events enable row level security;
alter table public.stripe_events force row level security;

create policy invoice_counters_select on public.invoice_counters
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
-- No authenticated insert/update: next_number advances only via service_role
-- or a SECURITY DEFINER RPC (not direct office writes).

create policy invoices_select on public.invoices
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy invoices_update on public.invoices
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
create policy invoice_lines_insert on public.invoice_lines
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy invoice_lines_update on public.invoice_lines
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy invoice_lines_delete on public.invoice_lines
  for delete to authenticated
  using ((select private.can_edit_customers(org_id)));

create policy payments_select on public.payments
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

create policy credit_notes_select on public.credit_notes
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
create policy credit_notes_write on public.credit_notes
  for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy account_credits_select on public.account_credits
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
create policy account_credits_write on public.account_credits
  for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy billing_events_select on public.billing_events
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
-- No authenticated insert/update/delete: append-only history is written only
-- by service_role (server-side functions / webhooks).

create policy stripe_events_select on public.stripe_events
  for select to authenticated
  using (
    org_id is not null
    and (select private.can_read_pricing(org_id))
  );

grant select on public.invoice_counters to authenticated;
grant select, insert, update on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_lines to authenticated;
grant select on public.payments to authenticated;
grant select, insert, update, delete on public.credit_notes to authenticated;
grant select, insert, update, delete on public.account_credits to authenticated;
grant select on public.billing_events to authenticated;
grant select on public.stripe_events to authenticated;

revoke insert, update, delete on public.invoice_counters from public, anon, authenticated;
revoke insert, update, delete on public.payments from public, anon, authenticated;
revoke insert, update, delete on public.billing_events from public, anon, authenticated;
revoke insert, update, delete on public.stripe_events from public, anon, authenticated;

grant all on public.invoice_counters, public.invoices, public.invoice_lines,
  public.payments, public.credit_notes, public.account_credits,
  public.billing_events, public.stripe_events to service_role;
