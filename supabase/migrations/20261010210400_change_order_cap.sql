-- I13: Change orders raise the billing cap on a ranged quote line after the
-- customer accepts on a public token link. Draft billing clamps at the
-- effective cap (range_high, or an accepted change order's new_cap_cents).

create type public.change_order_status as enum ('draft', 'sent', 'accepted', 'declined');

create table public.change_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  line_item_id uuid not null references public.quote_line_items(id) on delete restrict,
  public_token uuid not null default gen_random_uuid(),
  status public.change_order_status not null default 'draft',
  prior_cap_cents bigint not null check (prior_cap_cents >= 0),
  proposed_amount_cents bigint not null check (proposed_amount_cents > 0),
  new_cap_cents bigint not null check (new_cap_cents > 0),
  reason text,
  signer_name text,
  signer_email text,
  document_hash text,
  disclosure_accepted boolean,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint change_orders_proposed_above_prior check (proposed_amount_cents > prior_cap_cents),
  constraint change_orders_new_cap_matches_proposed check (new_cap_cents = proposed_amount_cents),
  constraint change_orders_accepted_fields check (
    (status = 'accepted' and accepted_at is not null and signer_name is not null and disclosure_accepted is true)
    or (status <> 'accepted' and accepted_at is null)
  ),
  constraint change_orders_sent_at check (
    (status in ('sent', 'accepted', 'declined') and sent_at is not null)
    or (status = 'draft' and sent_at is null)
  )
);

create unique index change_orders_public_token_key on public.change_orders (public_token);
create index change_orders_org_status_idx on public.change_orders (org_id, status);
create index change_orders_line_item_id_idx on public.change_orders (line_item_id);
create index change_orders_account_id_idx on public.change_orders (account_id);

-- At most one open (draft/sent) change order per line at a time.
create unique index change_orders_open_line_key
  on public.change_orders (line_item_id)
  where status in ('draft', 'sent');

create trigger change_orders_set_updated_at
  before update on public.change_orders
  for each row execute function private.set_updated_at();

create trigger change_orders_account_org
  before insert or update of org_id, account_id on public.change_orders
  for each row execute function private.child_org_guard('accounts', 'account_id');
create trigger change_orders_quote_org
  before insert or update of org_id, quote_id on public.change_orders
  for each row execute function private.child_org_guard('quotes', 'quote_id');
create trigger change_orders_line_item_org
  before insert or update of org_id, line_item_id on public.change_orders
  for each row execute function private.child_org_guard('quote_line_items', 'line_item_id');

comment on table public.change_orders is
  'Customer-accepted raise of a ranged line''s billing cap above range_high.';
comment on column public.change_orders.prior_cap_cents is
  'Effective billing cap in cents when the change order was created (range_high or a prior accepted raise).';
comment on column public.change_orders.proposed_amount_cents is
  'Amount the office wants to bill; becomes new_cap_cents on accept.';
comment on column public.change_orders.new_cap_cents is
  'Cap after acceptance; billable_line_amount_cents uses the max accepted new_cap.';

-- ---------------------------------------------------------------------------
-- Effective cap + billable amount (seam for invoice draft creation / I02)
-- ---------------------------------------------------------------------------
create or replace function public.line_billing_cap_cents(p_line_item_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(
    coalesce(
      (
        select round(i.range_high * 100)::bigint
        from public.quote_line_items i
        where i.id = p_line_item_id
          and i.range_low is not null
          and i.range_high is not null
      ),
      0
    ),
    coalesce(
      (
        select max(c.new_cap_cents)
        from public.change_orders c
        where c.line_item_id = p_line_item_id
          and c.status = 'accepted'
      ),
      0
    )
  );
$$;

comment on function public.line_billing_cap_cents(uuid) is
  'Effective billing cap for a quote line: range_high cents, raised by any accepted change order.';

create or replace function public.billable_line_amount_cents(
  p_line_item_id uuid,
  p_actual_cents bigint
)
returns bigint
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_line public.quote_line_items;
  v_cap bigint;
begin
  if p_actual_cents is null or p_actual_cents < 0 then
    raise exception 'actual cents must be non-negative' using errcode = '22023';
  end if;

  select * into v_line from public.quote_line_items where id = p_line_item_id;
  if not found then
    raise exception 'line item not found' using errcode = 'P0002';
  end if;

  -- Fixed (non-range) lines: bill the actual as provided by the caller.
  if v_line.range_low is null or v_line.range_high is null then
    return p_actual_cents;
  end if;

  v_cap := public.line_billing_cap_cents(p_line_item_id);
  return least(p_actual_cents, v_cap);
end;
$$;

comment on function public.billable_line_amount_cents(uuid, bigint) is
  'Clamp an actual amount to the line''s effective billing cap (range high / accepted change order).';

grant execute on function public.line_billing_cap_cents(uuid) to authenticated, service_role;
grant execute on function public.billable_line_amount_cents(uuid, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Office: create + send a change order for a ranged line
-- ---------------------------------------------------------------------------
create or replace function public.change_order_create(
  p_line_item_id uuid,
  p_proposed_amount_cents bigint,
  p_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line public.quote_line_items;
  v_quote uuid;
  v_account uuid;
  v_prior bigint;
  v_token uuid;
begin
  select i.* into v_line
  from public.quote_line_items i
  where i.id = p_line_item_id;
  if not found then
    raise exception 'line item not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(v_line.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_line.range_low is null or v_line.range_high is null then
    raise exception 'change orders apply only to ranged lines' using errcode = '22023';
  end if;
  if p_proposed_amount_cents is null or p_proposed_amount_cents <= 0 then
    raise exception 'proposed amount must be positive' using errcode = '22023';
  end if;

  v_prior := public.line_billing_cap_cents(p_line_item_id);
  if p_proposed_amount_cents <= v_prior then
    raise exception 'proposed amount must exceed the current cap' using errcode = '22023';
  end if;

  select q.id, q.account_id into v_quote, v_account
  from public.quote_versions v
  join public.quotes q on q.id = v.quote_id
  where v.id = v_line.version_id;

  insert into public.change_orders (
    org_id, account_id, quote_id, line_item_id,
    status, prior_cap_cents, proposed_amount_cents, new_cap_cents,
    reason, sent_at
  ) values (
    v_line.org_id, v_account, v_quote, p_line_item_id,
    'sent', v_prior, p_proposed_amount_cents, p_proposed_amount_cents,
    nullif(btrim(coalesce(p_reason, '')), ''), now()
  )
  returning public_token into v_token;

  return v_token;
end;
$$;

grant execute on function public.change_order_create(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Public read + accept (token is the only key)
-- ---------------------------------------------------------------------------
create or replace function public.change_order_public(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.change_orders;
  i public.quote_line_items;
  o public.orgs;
  a public.accounts;
begin
  select * into c from public.change_orders where public_token = p_token;
  if not found then
    return null;
  end if;
  if c.status = 'draft' then
    return null;
  end if;

  select * into i from public.quote_line_items where id = c.line_item_id;
  select * into o from public.orgs where id = c.org_id;
  select * into a from public.accounts where id = c.account_id;

  return jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'line_name', i.name,
    'prior_cap_cents', c.prior_cap_cents,
    'proposed_amount_cents', c.proposed_amount_cents,
    'new_cap_cents', c.new_cap_cents,
    'reason', c.reason,
    'accepted_at', c.accepted_at,
    'signer_name', c.signer_name,
    'org', jsonb_build_object(
      'name', o.name,
      'phone', o.phone,
      'email', o.email,
      'brand_color', o.brand_color
    ),
    'account_name', a.name
  );
end;
$$;

grant execute on function public.change_order_public(uuid) to anon, authenticated;

create or replace function public.change_order_accept(
  p_token uuid,
  p_signer_name text,
  p_signer_email text default null,
  p_disclosure boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.change_orders;
  v_hash text;
begin
  if coalesce(p_disclosure, false) is not true then
    raise exception 'ESIGN disclosure must be accepted' using errcode = '22023';
  end if;
  if p_signer_name is null or length(trim(p_signer_name)) < 2 then
    raise exception 'signer name required' using errcode = '22023';
  end if;

  select * into c from public.change_orders where public_token = p_token for update;
  if not found or c.status = 'draft' then
    raise exception 'change order not available' using errcode = 'P0002';
  end if;
  if c.status = 'accepted' then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'document_hash', c.document_hash,
      'change_order_id', c.id
    );
  end if;
  if c.status = 'declined' then
    raise exception 'change order was declined' using errcode = 'P0002';
  end if;

  v_hash := private.sha256_hex(
    c.id::text || ':' || c.line_item_id::text || ':' || c.proposed_amount_cents::text || ':' || c.updated_at::text
  );

  update public.change_orders
  set
    status = 'accepted',
    signer_name = trim(p_signer_name),
    signer_email = nullif(trim(coalesce(p_signer_email, '')), ''),
    disclosure_accepted = true,
    document_hash = v_hash,
    accepted_at = now()
  where id = c.id;

  insert into public.billing_events (org_id, kind, payload)
  values (
    c.org_id,
    'change_order.accepted',
    jsonb_build_object(
      'change_order_id', c.id,
      'line_item_id', c.line_item_id,
      'prior_cap_cents', c.prior_cap_cents,
      'new_cap_cents', c.new_cap_cents,
      'document_hash', v_hash,
      'signer_name', trim(p_signer_name)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'document_hash', v_hash,
    'change_order_id', c.id,
    'new_cap_cents', c.new_cap_cents
  );
end;
$$;

grant execute on function public.change_order_accept(uuid, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: office can manage; crew denied. Public access is RPC-only.
-- ---------------------------------------------------------------------------
alter table public.change_orders enable row level security;
alter table public.change_orders force row level security;

create policy change_orders_select on public.change_orders
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
create policy change_orders_insert on public.change_orders
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy change_orders_update on public.change_orders
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

grant select, insert, update on public.change_orders to authenticated;
grant all on public.change_orders to service_role;
