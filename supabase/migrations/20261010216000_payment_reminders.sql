-- I10 (#77): payment reminders at due / +7 / +14, then flag account once.
-- Late fees are intentionally not modeled. Paused while payment_dispute_open
-- or promise_to_pay_until is still in the future (inclusive).

alter table public.accounts
  add column if not exists payment_dispute_open boolean not null default false;

alter table public.accounts
  add column if not exists promise_to_pay_until date;

alter table public.accounts
  add column if not exists collections_flagged_at timestamptz;

comment on column public.accounts.payment_dispute_open is
  'I10/I09: when true, payment reminders are paused for this account.';
comment on column public.accounts.promise_to_pay_until is
  'I10: inclusive pause window for payment reminders (null = none).';
comment on column public.accounts.collections_flagged_at is
  'I10: set once after a +14 reminder so office can follow up.';

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_reminder_stage'
  ) then
    create type public.payment_reminder_stage as enum ('due', 'plus_7', 'plus_14');
  end if;
end;
$$;

-- One send per invoice per stage (idempotent cron reruns).
create table if not exists public.invoice_payment_reminder_runs (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  stage public.payment_reminder_stage not null,
  reminder_on date not null,
  created_at timestamptz not null default now(),
  primary key (invoice_id, stage)
);

create index if not exists invoice_payment_reminder_runs_org_on_idx
  on public.invoice_payment_reminder_runs (org_id, reminder_on);

create index if not exists invoice_payment_reminder_runs_reminder_on_idx
  on public.invoice_payment_reminder_runs (reminder_on);

alter table public.invoice_payment_reminder_runs enable row level security;
alter table public.invoice_payment_reminder_runs force row level security;

drop policy if exists invoice_payment_reminder_runs_select on public.invoice_payment_reminder_runs;
create policy invoice_payment_reminder_runs_select on public.invoice_payment_reminder_runs
  for select to authenticated
  using (
    private.has_org_role(
      org_id,
      array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[]
    )
  );

revoke all on table public.invoice_payment_reminder_runs from public, anon, authenticated;
grant select on table public.invoice_payment_reminder_runs to authenticated;
grant all on table public.invoice_payment_reminder_runs to service_role;

-- Returns true when this invoice/stage reminder was newly claimed.
create or replace function public.claim_invoice_payment_reminder(
  p_invoice_id uuid,
  p_org_id uuid,
  p_stage public.payment_reminder_stage,
  p_reminder_on date
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

  if not exists (
    select 1
    from public.invoices i
    where i.id = p_invoice_id
      and i.org_id = p_org_id
  ) then
    raise exception 'invoice not found in org' using errcode = 'P0002';
  end if;

  insert into public.invoice_payment_reminder_runs (invoice_id, org_id, stage, reminder_on)
  values (p_invoice_id, p_org_id, p_stage, p_reminder_on)
  on conflict do nothing
  returning invoice_id into claimed;

  if claimed is not null then
    insert into public.billing_events (org_id, invoice_id, kind, payload)
    values (
      p_org_id,
      p_invoice_id,
      'invoice.payment_reminder',
      jsonb_build_object(
        'stage', p_stage,
        'reminder_on', p_reminder_on
      )
    );
  end if;

  return claimed is not null;
end;
$$;

revoke all on function public.claim_invoice_payment_reminder(
  uuid, uuid, public.payment_reminder_stage, date
) from public, anon, authenticated;
grant execute on function public.claim_invoice_payment_reminder(
  uuid, uuid, public.payment_reminder_stage, date
) to service_role;

-- Sets collections_flagged_at once; returns true when newly flagged.
create or replace function public.flag_account_collections(
  p_account_id uuid,
  p_org_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  flagged uuid;
begin
  if auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.accounts a
    where a.id = p_account_id
      and a.org_id = p_org_id
  ) then
    raise exception 'account not found in org' using errcode = 'P0002';
  end if;

  update public.accounts
  set collections_flagged_at = now()
  where id = p_account_id
    and org_id = p_org_id
    and collections_flagged_at is null
  returning id into flagged;

  if flagged is not null then
    insert into public.billing_events (org_id, kind, payload)
    values (
      p_org_id,
      'account.collections_flagged',
      jsonb_build_object('account_id', p_account_id)
    );
  end if;

  return flagged is not null;
end;
$$;

revoke all on function public.flag_account_collections(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.flag_account_collections(uuid, uuid) to service_role;
