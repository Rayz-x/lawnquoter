-- L12 (#127): daily follow-up digest idempotency + stale helper.
-- Does not create lead_requests (L01). Cron email runs in the app at 7 AM company time.

create or replace function private.lead_is_stale(
  p_last_activity_at timestamptz,
  p_as_of date default (timezone('utc', now()))::date,
  p_days integer default 7
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_last_activity_at is null then true
    else ((p_as_of - (p_last_activity_at at time zone 'utc')::date) >= p_days)
  end;
$$;

revoke all on function private.lead_is_stale(timestamptz, date, integer) from public;
grant execute on function private.lead_is_stale(timestamptz, date, integer) to service_role;

-- One digest email per assignee per org calendar day.
create table public.lead_follow_up_digest_runs (
  org_id uuid not null references public.orgs(id) on delete cascade,
  assignee_id uuid not null references auth.users(id) on delete cascade,
  digest_on date not null,
  created_at timestamptz not null default now(),
  primary key (org_id, assignee_id, digest_on)
);

create index lead_follow_up_digest_runs_digest_on_idx
  on public.lead_follow_up_digest_runs (digest_on);

alter table public.lead_follow_up_digest_runs enable row level security;

-- Office may read delivery history; only service_role writes (via claim RPC).
create policy lead_follow_up_digest_runs_select on public.lead_follow_up_digest_runs
  for select to authenticated
  using (
    private.has_org_role(
      org_id,
      array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[]
    )
  );

revoke all on table public.lead_follow_up_digest_runs from public, anon, authenticated;
grant select on table public.lead_follow_up_digest_runs to authenticated;
grant all on table public.lead_follow_up_digest_runs to service_role;

-- Returns true when this assignee's digest for the day was newly claimed.
create or replace function public.claim_lead_follow_up_digest(
  p_org_id uuid,
  p_assignee_id uuid,
  p_digest_on date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid;
begin
  if auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.lead_follow_up_digest_runs (org_id, assignee_id, digest_on)
  values (p_org_id, p_assignee_id, p_digest_on)
  on conflict do nothing
  returning org_id into claimed;

  return claimed is not null;
end;
$$;

revoke all on function public.claim_lead_follow_up_digest(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.claim_lead_follow_up_digest(uuid, uuid, date) to service_role;
