-- Call tracking. Office can read. Only the webhook role writes.

alter table public.orgs add column if not exists call_tracking_number text;

create unique index if not exists orgs_call_tracking_number_idx
  on public.orgs (call_tracking_number) where call_tracking_number is not null;

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  direction text not null default 'in',
  from_address text not null,
  to_address text not null,
  status text not null default 'completed',
  duration_seconds integer,
  recording_url text,
  provider text not null,
  provider_id text not null,
  account_id uuid references public.accounts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  activity_id uuid references public.activities(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint calls_direction_chk check (direction in ('in', 'out')),
  constraint calls_provider_chk check (provider in ('callrail', 'twilio')),
  constraint calls_duration_chk check (duration_seconds is null or duration_seconds >= 0)
);

create unique index if not exists calls_provider_id_idx
  on public.calls (org_id, provider, provider_id);

alter table public.calls enable row level security;
alter table public.calls force row level security;

drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[])));

revoke all on table public.calls from public, anon, authenticated;
grant select on table public.calls to authenticated;
grant all on table public.calls to service_role;
