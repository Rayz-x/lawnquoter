-- QuickBooks refresh tokens stay on the server. Owners can see the realm, not the tokens.

create table if not exists public.qbo_oauth_tokens (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.qbo_oauth_tokens enable row level security;
alter table public.qbo_oauth_tokens force row level security;

revoke all on public.qbo_oauth_tokens from public, anon, authenticated;
grant all on public.qbo_oauth_tokens to service_role;
