-- Card on file. Office can read brand and last4. Stripe ids are written
-- only by the server (service_role). Crew and sales cannot read the rows.

create table if not exists public.account_payment_methods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  stripe_customer_id text not null check (length(btrim(stripe_customer_id)) between 1 and 80),
  stripe_payment_method_id text not null check (length(btrim(stripe_payment_method_id)) between 1 and 80),
  kind text not null check (kind in ('card', 'us_bank_account')),
  brand text check (brand is null or length(btrim(brand)) between 1 and 32),
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month smallint check (exp_month is null or exp_month between 1 and 12),
  exp_year smallint check (exp_year is null or exp_year between 2000 and 2100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists account_payment_methods_stripe_pm_key
  on public.account_payment_methods (stripe_payment_method_id);

create unique index if not exists account_payment_methods_one_default
  on public.account_payment_methods (account_id)
  where is_default;

create index if not exists account_payment_methods_account_idx
  on public.account_payment_methods (org_id, account_id);

drop trigger if exists account_payment_methods_set_updated_at on public.account_payment_methods;
create trigger account_payment_methods_set_updated_at
  before update on public.account_payment_methods
  for each row execute function private.set_updated_at();

drop trigger if exists account_payment_methods_account_org on public.account_payment_methods;
create trigger account_payment_methods_account_org
  before insert or update of org_id, account_id on public.account_payment_methods
  for each row execute function private.child_org_guard('accounts', 'account_id');

alter table public.account_payment_methods enable row level security;
alter table public.account_payment_methods force row level security;

drop policy if exists account_payment_methods_select on public.account_payment_methods;
create policy account_payment_methods_select on public.account_payment_methods
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

revoke all on public.account_payment_methods from public, anon, authenticated;
grant select on public.account_payment_methods to authenticated;
grant all on public.account_payment_methods to service_role;
