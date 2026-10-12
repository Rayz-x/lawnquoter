-- Flat LawnQuoter plan per company. Authenticated users can read their own
-- company's row (owner and admin). Writes stay on the service role.

create table public.org_subscriptions (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  tier text not null check (tier in ('starter', 'growth', 'scale')),
  status text not null check (status in ('incomplete', 'active', 'past_due', 'canceled')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger org_subscriptions_set_updated_at
  before update on public.org_subscriptions
  for each row execute function private.set_updated_at();

alter table public.org_subscriptions enable row level security;
alter table public.org_subscriptions force row level security;

create policy org_subscriptions_select on public.org_subscriptions
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

revoke all on public.org_subscriptions from public, anon, authenticated;
grant select on public.org_subscriptions to authenticated;
grant all on public.org_subscriptions to service_role;
