-- I11: Payments page support — payment method (compatible with I08), account
-- statement token links, and public statement RPC. Hosted apply needs Dusty's OK.

-- ---------------------------------------------------------------------------
-- Payment method (I08 may already have added these)
-- ---------------------------------------------------------------------------
do $$
begin
  create type public.ledger_payment_method as enum (
    'stripe',
    'cash',
    'check',
    'account_credit'
  );
exception
  when duplicate_object then null;
end
$$;

alter table public.payments
  add column if not exists method public.ledger_payment_method not null default 'stripe';

alter table public.payments
  add column if not exists note text;

create index if not exists payments_method_idx on public.payments (org_id, method);
create index if not exists payments_status_idx on public.payments (org_id, status);

-- ---------------------------------------------------------------------------
-- Per-account statement token (office mint; crew denied via can_read_pricing)
-- ---------------------------------------------------------------------------
create table if not exists public.account_statement_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  public_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_statement_links_org_account_key unique (org_id, account_id),
  constraint account_statement_links_token_key unique (public_token)
);

create index if not exists account_statement_links_account_id_idx
  on public.account_statement_links (account_id);

create trigger account_statement_links_set_updated_at
  before update on public.account_statement_links
  for each row execute function private.set_updated_at();

create trigger account_statement_links_account_org
  before insert or update of org_id, account_id on public.account_statement_links
  for each row execute function private.child_org_guard('accounts', 'account_id');

alter table public.account_statement_links enable row level security;
alter table public.account_statement_links force row level security;

create policy account_statement_links_select on public.account_statement_links
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

create policy account_statement_links_insert on public.account_statement_links
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));

create policy account_statement_links_update on public.account_statement_links
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

grant select, insert, update on public.account_statement_links to authenticated;
revoke delete on public.account_statement_links from public, anon, authenticated;
grant all on public.account_statement_links to service_role;

-- ---------------------------------------------------------------------------
-- Mint / return statement token for an account
-- ---------------------------------------------------------------------------
create or replace function public.ensure_account_statement_link(p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_token uuid;
begin
  if p_account_id is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  select org_id into v_org from public.accounts where id = p_account_id;
  if v_org is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.account_statement_links (org_id, account_id)
  values (v_org, p_account_id)
  on conflict (org_id, account_id) do update
    set updated_at = now()
  returning public_token into v_token;

  return v_token;
end;
$$;

revoke all on function public.ensure_account_statement_link(uuid) from public, anon;
grant execute on function public.ensure_account_statement_link(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public account statement by token (opening / invoices / payments / credits)
-- ---------------------------------------------------------------------------
create or replace function public.account_statement_public(
  p_token uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.account_statement_links;
  v_org public.orgs;
  v_account public.accounts;
  v_opening bigint;
  v_invoice_cents bigint;
  v_payment_cents bigint;
  v_credit_cents bigint;
  v_lines jsonb;
begin
  if p_token is null or p_from is null or p_to is null or p_to < p_from then
    return null;
  end if;

  select * into v_link
  from public.account_statement_links
  where public_token = p_token;

  if not found then
    return null;
  end if;

  select * into v_org from public.orgs where id = v_link.org_id;
  select * into v_account from public.accounts where id = v_link.account_id;

  select coalesce(sum(i.total_cents), 0)::bigint into v_opening
  from public.invoices i
  where i.account_id = v_link.account_id
    and i.status in ('issued', 'paid')
    and i.issued_at is not null
    and (i.issued_at at time zone 'utc')::date < p_from;

  v_opening := v_opening
    - coalesce((
        select sum(p.amount_cents)::bigint
        from public.payments p
        where p.account_id = v_link.account_id
          and p.status = 'succeeded'
          and coalesce(p.received_at, p.created_at) is not null
          and (coalesce(p.received_at, p.created_at) at time zone 'utc')::date < p_from
      ), 0)
    - coalesce((
        select sum(c.amount_cents)::bigint
        from public.credit_notes c
        where c.account_id = v_link.account_id
          and (c.issued_at at time zone 'utc')::date < p_from
      ), 0);

  select coalesce(sum(i.total_cents), 0)::bigint into v_invoice_cents
  from public.invoices i
  where i.account_id = v_link.account_id
    and i.status in ('issued', 'paid')
    and i.issued_at is not null
    and (i.issued_at at time zone 'utc')::date between p_from and p_to;

  select coalesce(sum(p.amount_cents), 0)::bigint into v_payment_cents
  from public.payments p
  where p.account_id = v_link.account_id
    and p.status = 'succeeded'
    and (coalesce(p.received_at, p.created_at) at time zone 'utc')::date between p_from and p_to;

  select coalesce(sum(c.amount_cents), 0)::bigint into v_credit_cents
  from public.credit_notes c
  where c.account_id = v_link.account_id
    and (c.issued_at at time zone 'utc')::date between p_from and p_to;

  select coalesce(jsonb_agg(line order by line->>'on', line->>'id'), '[]'::jsonb)
  into v_lines
  from (
    select jsonb_build_object(
      'kind', 'invoice',
      'id', i.id,
      'on', (i.issued_at at time zone 'utc')::date,
      'amount_cents', i.total_cents,
      'label', case
        when i.number is not null then 'Invoice #' || i.number::text
        else 'Invoice'
      end
    ) as line
    from public.invoices i
    where i.account_id = v_link.account_id
      and i.status in ('issued', 'paid')
      and i.issued_at is not null
      and (i.issued_at at time zone 'utc')::date between p_from and p_to

    union all

    select jsonb_build_object(
      'kind', 'payment',
      'id', p.id,
      'on', (coalesce(p.received_at, p.created_at) at time zone 'utc')::date,
      'amount_cents', p.amount_cents,
      'label', 'Payment (' || p.method::text || ')'
    ) as line
    from public.payments p
    where p.account_id = v_link.account_id
      and p.status = 'succeeded'
      and (coalesce(p.received_at, p.created_at) at time zone 'utc')::date between p_from and p_to

    union all

    select jsonb_build_object(
      'kind', 'credit',
      'id', c.id,
      'on', (c.issued_at at time zone 'utc')::date,
      'amount_cents', c.amount_cents,
      'label', case
        when c.reason is not null and length(btrim(c.reason)) > 0
          then 'Credit — ' || btrim(c.reason)
        else 'Credit'
      end
    ) as line
    from public.credit_notes c
    where c.account_id = v_link.account_id
      and (c.issued_at at time zone 'utc')::date between p_from and p_to
  ) lines;

  return jsonb_build_object(
    'account_id', v_account.id,
    'account_name', v_account.name,
    'from', p_from,
    'to', p_to,
    'opening_cents', v_opening,
    'invoice_cents', v_invoice_cents,
    'payment_cents', v_payment_cents,
    'credit_cents', v_credit_cents,
    'closing_cents', v_opening + v_invoice_cents - v_payment_cents - v_credit_cents,
    'lines', v_lines,
    'org', jsonb_build_object(
      'name', v_org.name,
      'phone', v_org.phone,
      'email', v_org.email,
      'website', v_org.website,
      'brand_color', v_org.brand_color,
      'logo_url', v_org.logo_path,
      'logo_dark_url', v_org.logo_dark_path,
      'logo_raster_url', v_org.logo_raster_path,
      'logo_width', v_org.logo_width,
      'logo_height', v_org.logo_height,
      'logo_shows_name', v_org.logo_shows_name,
      'logo_needs_chip', v_org.logo_needs_chip,
      'heading_font', v_org.heading_font,
      'address_line1', v_org.address_line1,
      'address_line2', v_org.address_line2,
      'city', v_org.city,
      'region', v_org.region,
      'postal_code', v_org.postal_code,
      'country', v_org.country
    )
  );
end;
$$;

revoke all on function public.account_statement_public(uuid, date, date) from public;
grant execute on function public.account_statement_public(uuid, date, date)
  to anon, authenticated, service_role;
