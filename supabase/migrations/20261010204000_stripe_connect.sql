-- I06: one Stripe Connect Express account per company.
-- Authenticated: SELECT only (owner+admin). Writes are service_role / trusted server.
-- Hosted apply requires Dusty's OK; this migration is not applied here.

create type public.stripe_connect_status as enum ('not_connected', 'pending', 'ready');

create table public.org_stripe_connect (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  stripe_account_id text unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  status public.stripe_connect_status not null default 'not_connected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_stripe_connect_account_when_linked
    check (status = 'not_connected' or stripe_account_id is not null)
);

create trigger org_stripe_connect_set_updated_at
  before update on public.org_stripe_connect
  for each row execute function private.set_updated_at();

alter table public.org_stripe_connect enable row level security;
alter table public.org_stripe_connect force row level security;

create policy org_stripe_connect_select on public.org_stripe_connect
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

revoke all on public.org_stripe_connect from public, anon, authenticated;
grant select on public.org_stripe_connect to authenticated;
grant all on public.org_stripe_connect to service_role;

create or replace function public.org_payments_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_stripe_connect c
    where c.org_id = private.current_org_id()
      and c.status = 'ready' and c.charges_enabled and c.payouts_enabled
  );
$$;

revoke all on function public.org_payments_ready() from public, anon;
grant execute on function public.org_payments_ready() to authenticated, service_role;
