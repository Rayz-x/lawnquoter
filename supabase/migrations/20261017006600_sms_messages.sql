-- Two-way SMS log. Office can read. Sales and dispatch can send. Crew cannot.
-- Inbound rows are written by the Twilio webhook as service_role.

alter table public.orgs add column if not exists sms_number text;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  channel text not null default 'sms',
  direction text not null,
  status text not null,
  from_address text not null,
  to_address text not null,
  body text not null,
  provider text,
  provider_id text,
  error text,
  account_id uuid references public.accounts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  lead_request_id uuid references public.lead_requests(id) on delete set null,
  activity_id uuid references public.activities(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint messages_channel_chk check (channel in ('sms', 'email')),
  constraint messages_direction_chk check (direction in ('in', 'out')),
  constraint messages_status_chk check (status in ('queued', 'sent', 'failed', 'received')),
  constraint messages_body_chk check (char_length(btrim(body)) between 1 and 1600)
);

create index if not exists messages_org_occurred_idx on public.messages (org_id, occurred_at desc);
create unique index if not exists messages_provider_sid_idx
  on public.messages (org_id, provider, provider_id) where provider_id is not null;
create index if not exists orgs_sms_number_idx on public.orgs (sms_number) where sms_number is not null;

alter table public.messages enable row level security;
alter table public.messages force row level security;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[])));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher']::public.org_role[])));

revoke all on table public.messages from public, anon, authenticated;
grant select, insert on table public.messages to authenticated;
grant all on table public.messages to service_role;
