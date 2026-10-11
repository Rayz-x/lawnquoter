-- L15 (#130): scheduled lead retention purge.
--
-- Dusty-OK / Merge Danger: DESTRUCTIVE DATA DELETE. Purges PII-bearing
-- lead_requests (and cascaded lead_activities). Do not merge or apply to
-- hosted until Dusty has reviewed and approved.
--
-- Rules (per-org retention settings; defaults 30 / 365):
--   * spam older than spam retention days → purge
--   * lost / never-converted older than unconverted retention days → purge
--   * converted leads (won, or linked account/property/quote) → never purge
--   * aggregate counts preserved in lead_retention_aggregates

-- ---------------------------------------------------------------------------
-- Aggregate counts kept after purge (no PII)
-- ---------------------------------------------------------------------------
create table public.lead_retention_aggregates (
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_on date not null,
  status public.lead_request_status not null,
  source text not null default '',
  purged_count integer not null default 0 check (purged_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, created_on, status, source)
);

comment on table public.lead_retention_aggregates is
  'Counts of leads removed by retention purge. Kept so volume reports survive PII deletion.';

create index lead_retention_aggregates_org_created_idx
  on public.lead_retention_aggregates (org_id, created_on);

alter table public.lead_retention_aggregates enable row level security;
alter table public.lead_retention_aggregates force row level security;

create policy lead_retention_aggregates_select on public.lead_retention_aggregates
  for select to authenticated
  using (
    private.has_org_role(
      org_id,
      array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[]
    )
  );

revoke all on table public.lead_retention_aggregates from public, anon, authenticated;
grant select on table public.lead_retention_aggregates to authenticated;
grant all on table public.lead_retention_aggregates to service_role;

-- ---------------------------------------------------------------------------
-- Converted = won or linked to account / property / quote
-- ---------------------------------------------------------------------------
create or replace function private.lead_is_converted(
  p_status public.lead_request_status,
  p_account_id uuid,
  p_property_id uuid,
  p_quote_id uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_status = 'won'::public.lead_request_status
    or p_account_id is not null
    or p_property_id is not null
    or p_quote_id is not null;
$$;

revoke all on function private.lead_is_converted(
  public.lead_request_status, uuid, uuid, uuid
) from public, anon;
grant execute on function private.lead_is_converted(
  public.lead_request_status, uuid, uuid, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- Nightly purge (service_role / pg_cron only)
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_leads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  -- Nightly cron / service_role have no auth.uid(). Block JWT members.
  if auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with doomed as (
    select
      lr.id,
      lr.org_id,
      (lr.created_at at time zone 'utc')::date as created_on,
      lr.status,
      coalesce(lr.source, '') as source
    from public.lead_requests lr
    where not private.lead_is_converted(
      lr.status, lr.account_id, lr.property_id, lr.quote_id
    )
      and (
        (
          lr.status = 'spam'::public.lead_request_status
          and lr.created_at
            < now() - make_interval(days => private.lead_spam_retention_days(lr.org_id))
        )
        or (
          lr.status <> 'spam'::public.lead_request_status
          and lr.created_at
            < now()
              - make_interval(days => private.lead_unconverted_retention_days(lr.org_id))
        )
      )
  ),
  tallied as (
    -- Data-modifying CTEs always run to completion even if unread.
    insert into public.lead_retention_aggregates as agg (
      org_id, created_on, status, source, purged_count, updated_at
    )
    select
      d.org_id,
      d.created_on,
      d.status,
      d.source,
      count(*)::integer,
      now()
    from doomed d
    group by d.org_id, d.created_on, d.status, d.source
    on conflict (org_id, created_on, status, source) do update
      set
        purged_count = agg.purged_count + excluded.purged_count,
        updated_at = now()
    returning 1
  ),
  removed as (
    delete from public.lead_requests lr
    using doomed d
    where lr.id = d.id
    returning lr.id
  )
  select count(*)::integer into v_deleted
  from removed
  -- Force tallied to execute alongside the delete.
  where (select count(*) from tallied) >= 0;

  return coalesce(v_deleted, 0);
end;
$$;

comment on function public.purge_expired_leads() is
  'Deletes expired spam / lost / never-converted leads; keeps converted rows and aggregate counts. service_role / cron only.';

revoke all on function public.purge_expired_leads() from public, anon, authenticated;
grant execute on function public.purge_expired_leads() to service_role;

-- Schedule on hosted when pg_cron is available. Local/CI without the extension skip.
do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available; schedule purge_expired_leads on hosted';
    return;
  end if;

  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be created; schedule purge_expired_leads on hosted';
    return;
  end;

  if exists (select 1 from cron.job where jobname = 'purge_expired_leads') then
    perform cron.unschedule(j.jobid)
    from cron.job j
    where j.jobname = 'purge_expired_leads';
  end if;

  perform cron.schedule(
    'purge_expired_leads',
    '40 11 * * *',
    $job$select public.purge_expired_leads()$job$
  );
exception when others then
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$cron$;
