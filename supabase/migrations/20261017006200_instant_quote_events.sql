-- Abandoned instant quotes. Office can read. Writes go through the service role.

create table if not exists public.instant_quote_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null default 'abandoned' check (kind = 'abandoned'),
  address text not null check (length(btrim(address)) between 1 and 500),
  postal_code text,
  service text,
  lot_sqft numeric,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  created_at timestamptz not null default now()
);

comment on table public.instant_quote_events is
  'A visitor left the instant-quote widget with an address and no phone or email.';

create index if not exists instant_quote_events_org_created_idx
  on public.instant_quote_events (org_id, created_at desc);

alter table public.instant_quote_events enable row level security;
alter table public.instant_quote_events force row level security;

drop policy if exists instant_quote_events_select on public.instant_quote_events;
create policy instant_quote_events_select on public.instant_quote_events
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

revoke all on public.instant_quote_events from public, anon;
grant select on public.instant_quote_events to authenticated;
grant all on public.instant_quote_events to service_role;
