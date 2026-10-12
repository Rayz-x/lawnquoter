-- QuickBooks links, sync log, and conflicts. Office can read. Writes stay on service_role
-- until a sync runs. Off until QBO_CLIENT_ID and QBO_CLIENT_SECRET are set.

create table if not exists public.qbo_connections (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  realm_id text,
  connected_at timestamptz
);

create table if not exists public.qbo_entity_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  local_table text not null check (local_table in ('accounts', 'invoices', 'payments')),
  local_id uuid not null,
  qbo_entity text not null,
  qbo_id text not null,
  sync_token text,
  parent_qbo_id text,
  last_synced_at timestamptz,
  remote_updated_at timestamptz,
  unique (org_id, local_table, local_id)
);

create table if not exists public.qbo_sync_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  direction text not null check (direction in ('push', 'pull')),
  entity text not null,
  local_id uuid,
  qbo_id text,
  outcome text not null,
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists public.qbo_conflicts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  link_id uuid references public.qbo_entity_links(id) on delete cascade,
  local_name text not null,
  remote_name text not null,
  status text not null default 'open' check (status in ('open', 'kept_ours', 'kept_theirs')),
  created_at timestamptz not null default now()
);

create index if not exists qbo_entity_links_org_idx on public.qbo_entity_links (org_id);
create index if not exists qbo_sync_log_org_idx on public.qbo_sync_log (org_id, created_at desc);
create index if not exists qbo_conflicts_org_idx on public.qbo_conflicts (org_id, status);

alter table public.qbo_connections enable row level security;
alter table public.qbo_connections force row level security;
alter table public.qbo_entity_links enable row level security;
alter table public.qbo_entity_links force row level security;
alter table public.qbo_sync_log enable row level security;
alter table public.qbo_sync_log force row level security;
alter table public.qbo_conflicts enable row level security;
alter table public.qbo_conflicts force row level security;

create policy qbo_connections_select on public.qbo_connections
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));
create policy qbo_entity_links_select on public.qbo_entity_links
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));
create policy qbo_sync_log_select on public.qbo_sync_log
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));
create policy qbo_conflicts_select on public.qbo_conflicts
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

revoke all on public.qbo_connections from public, anon, authenticated;
revoke all on public.qbo_entity_links from public, anon, authenticated;
revoke all on public.qbo_sync_log from public, anon, authenticated;
revoke all on public.qbo_conflicts from public, anon, authenticated;
grant select on public.qbo_connections, public.qbo_entity_links, public.qbo_sync_log, public.qbo_conflicts to authenticated;
grant all on public.qbo_connections, public.qbo_entity_links, public.qbo_sync_log, public.qbo_conflicts to service_role;

create or replace function public.resolve_qbo_conflict(p_id uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
begin
  if v_org is null or not private.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_choice is distinct from 'kept_ours' and p_choice is distinct from 'kept_theirs' then
    raise exception 'choose ours or QuickBooks' using errcode = '22023';
  end if;
  update public.qbo_conflicts
  set status = p_choice
  where id = p_id and org_id = v_org and status = 'open';
  if not found then
    raise exception 'conflict not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.resolve_qbo_conflict(uuid, text) from public, anon;
grant execute on function public.resolve_qbo_conflict(uuid, text) to authenticated, service_role;

