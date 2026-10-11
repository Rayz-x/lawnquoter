-- I08: credit notes, void, account credit auto-apply, office cash/check payments.
-- Additive on the I01 ledger + I04 issue_invoice. Staff still cannot write payments
-- directly; office cash/check goes through SECURITY DEFINER RPCs. Credit notes never
-- mutate issued invoice totals.

-- ---------------------------------------------------------------------------
-- Payment method (Stripe webhook vs office cash/check vs applied account credit)
-- ---------------------------------------------------------------------------
create type public.ledger_payment_method as enum (
  'stripe',
  'cash',
  'check',
  'account_credit'
);

alter table public.payments
  add column if not exists method public.ledger_payment_method not null default 'stripe';

alter table public.payments
  add column if not exists note text;

create index if not exists payments_method_idx on public.payments (org_id, method);

-- Credit note / account credit mutations go through RPCs for auditability.
revoke insert, update, delete on public.credit_notes from public, anon, authenticated;
revoke insert, update, delete on public.account_credits from public, anon, authenticated;
grant select on public.credit_notes to authenticated;
grant select on public.account_credits to authenticated;
grant all on public.credit_notes, public.account_credits to service_role;

-- ---------------------------------------------------------------------------
-- Balance: total − succeeded payments − credit notes (floored at 0)
-- ---------------------------------------------------------------------------
create or replace function private.invoice_balance_cents(p_invoice_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select greatest(
        0::bigint,
        coalesce(i.total_cents, 0)
          - coalesce((
              select sum(p.amount_cents)::bigint
              from public.payments p
              where p.invoice_id = i.id
                and p.status = 'succeeded'
            ), 0)
          - coalesce((
              select sum(cn.amount_cents)::bigint
              from public.credit_notes cn
              where cn.invoice_id = i.id
            ), 0)
      )
      from public.invoices i
      where i.id = p_invoice_id
    ),
    0::bigint
  );
$$;

revoke all on function private.invoice_balance_cents(uuid) from public, anon, authenticated;
grant execute on function private.invoice_balance_cents(uuid) to service_role;

create or replace function public.invoice_balance_cents(p_invoice_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invoices where id = p_invoice_id;
  if v_org is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if not (
    private.can_read_pricing(v_org)
    or private.is_org_admin(v_org)
    or current_setting('role', true) = 'service_role'
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.invoice_balance_cents(p_invoice_id);
end;
$$;

revoke all on function public.invoice_balance_cents(uuid) from public, anon;
grant execute on function public.invoice_balance_cents(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mark issued invoice paid when outstanding balance hits zero.
-- ---------------------------------------------------------------------------
create or replace function private.maybe_mark_invoice_paid(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_balance bigint;
begin
  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    return;
  end if;

  if v_inv.status is distinct from 'issued' then
    return;
  end if;

  v_balance := private.invoice_balance_cents(p_invoice_id);
  if v_balance = 0 then
    update public.invoices
    set status = 'paid', paid_at = now()
    where id = p_invoice_id;
  end if;
end;
$$;

revoke all on function private.maybe_mark_invoice_paid(uuid) from public, anon, authenticated;
grant execute on function private.maybe_mark_invoice_paid(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Apply available account credit to a draft (or unpaid issued) invoice.
-- ---------------------------------------------------------------------------
create or replace function private.apply_account_credit_to_invoice(p_invoice_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_credit public.account_credits;
  v_due bigint;
  v_apply bigint;
  v_before_balance bigint;
  v_payment_id uuid;
  v_uid uuid := (select auth.uid());
begin
  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    return 0;
  end if;

  if v_inv.status not in ('draft', 'issued') then
    return 0;
  end if;

  v_due := private.invoice_balance_cents(v_inv.id);
  if v_due <= 0 then
    return 0;
  end if;

  select * into v_credit
  from public.account_credits
  where org_id = v_inv.org_id
    and account_id = v_inv.account_id
    and currency = v_inv.currency
  for update;

  if not found or v_credit.balance_cents <= 0 then
    return 0;
  end if;

  v_before_balance := v_credit.balance_cents;
  v_apply := least(v_credit.balance_cents, v_due);
  if v_apply <= 0 then
    return 0;
  end if;

  update public.account_credits
  set balance_cents = balance_cents - v_apply
  where id = v_credit.id;

  insert into public.payments (
    org_id, account_id, invoice_id, amount_cents, currency, status, method,
    received_at, note
  ) values (
    v_inv.org_id, v_inv.account_id, v_inv.id, v_apply, v_inv.currency,
    'succeeded', 'account_credit', now(), 'Applied account credit'
  ) returning id into v_payment_id;

  insert into public.billing_events (
    org_id, invoice_id, payment_id, kind, payload
  ) values (
    v_inv.org_id,
    v_inv.id,
    v_payment_id,
    'account_credit.applied',
    jsonb_build_object(
      'actor_id', v_uid,
      'reason', 'Auto-applied account credit',
      'before', jsonb_build_object(
        'account_credit_cents', v_before_balance,
        'invoice_balance_cents', v_due,
        'invoice_status', v_inv.status
      ),
      'after', jsonb_build_object(
        'account_credit_cents', v_before_balance - v_apply,
        'applied_cents', v_apply,
        'invoice_balance_cents', v_due - v_apply,
        'payment_id', v_payment_id,
        'method', 'account_credit'
      )
    )
  );

  if v_inv.status = 'issued' then
    perform private.maybe_mark_invoice_paid(v_inv.id);
  end if;

  return v_apply;
end;
$$;

revoke all on function private.apply_account_credit_to_invoice(uuid) from public, anon, authenticated;
grant execute on function private.apply_account_credit_to_invoice(uuid) to service_role;

-- Auto-apply when a draft's totals are written (insert or update).
create or replace function private.invoices_auto_apply_account_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Draft inserts/updates, and issue_invoice (totals often land with status=issued).
  if new.status in ('draft', 'issued') and new.total_cents > 0 then
    perform private.apply_account_credit_to_invoice(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_auto_apply_account_credit on public.invoices;
create trigger invoices_auto_apply_account_credit
  after insert or update of total_cents, status on public.invoices
  for each row execute function private.invoices_auto_apply_account_credit();

revoke all on function private.invoices_auto_apply_account_credit() from public, anon;
grant execute on function private.invoices_auto_apply_account_credit()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_credit_note — owner/admin; never edits invoice totals
-- ---------------------------------------------------------------------------
create or replace function public.create_credit_note(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_balance bigint;
  v_excess bigint;
  v_credit_id uuid;
  v_note_id uuid;
  v_before_credit bigint := 0;
  v_after_credit bigint := 0;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'credit amount must be positive' using errcode = '22023';
  end if;

  if v_reason is null then
    raise exception 'reason is required' using errcode = '22023';
  end if;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  if not private.is_org_admin(v_inv.org_id) then
    raise exception 'only owner or admin can create credit notes' using errcode = '42501';
  end if;

  if v_inv.status not in ('issued', 'paid') then
    raise exception 'credit notes require an issued or paid invoice' using errcode = '22023';
  end if;

  v_balance := private.invoice_balance_cents(v_inv.id);
  -- Amount beyond outstanding balance becomes unapplied account credit.
  v_excess := greatest(0, p_amount_cents - v_balance);

  v_before_credit := 0;
  select balance_cents into v_before_credit
  from public.account_credits
  where org_id = v_inv.org_id
    and account_id = v_inv.account_id
    and currency = v_inv.currency;
  if not found then
    v_before_credit := 0;
  end if;

  insert into public.credit_notes (
    org_id, account_id, invoice_id, amount_cents, currency, reason
  ) values (
    v_inv.org_id, v_inv.account_id, v_inv.id, p_amount_cents, v_inv.currency, v_reason
  ) returning id into v_note_id;

  if v_excess > 0 then
    insert into public.account_credits (
      org_id, account_id, balance_cents, currency
    ) values (
      v_inv.org_id, v_inv.account_id, v_excess, v_inv.currency
    )
    on conflict (org_id, account_id, currency) do update
      set balance_cents = public.account_credits.balance_cents + excluded.balance_cents
    returning id, balance_cents into v_credit_id, v_after_credit;
  else
    v_after_credit := v_before_credit;
    select id into v_credit_id
    from public.account_credits
    where org_id = v_inv.org_id
      and account_id = v_inv.account_id
      and currency = v_inv.currency;
  end if;

  insert into public.billing_events (org_id, invoice_id, kind, payload)
  values (
    v_inv.org_id,
    v_inv.id,
    'credit_note.created',
    jsonb_build_object(
      'actor_id', v_uid,
      'reason', v_reason,
      'credit_note_id', v_note_id,
      'before', jsonb_build_object(
        'invoice_status', v_inv.status,
        'invoice_total_cents', v_inv.total_cents,
        'invoice_balance_cents', v_balance,
        'account_credit_cents', v_before_credit
      ),
      'after', jsonb_build_object(
        'invoice_status', v_inv.status,
        'invoice_total_cents', v_inv.total_cents,
        'invoice_balance_cents', private.invoice_balance_cents(v_inv.id),
        'credit_note_cents', p_amount_cents,
        'account_credit_cents', v_after_credit,
        'account_credit_added_cents', v_excess
      )
    )
  );

  -- Covering a remaining balance with a credit note settles the invoice.
  perform private.maybe_mark_invoice_paid(v_inv.id);

  return jsonb_build_object(
    'credit_note_id', v_note_id,
    'amount_cents', p_amount_cents,
    'account_credit_added_cents', v_excess,
    'invoice_balance_cents', private.invoice_balance_cents(v_inv.id),
    'invoice_id', v_inv.id
  );
end;
$$;

revoke all on function public.create_credit_note(uuid, bigint, text) from public, anon;
grant execute on function public.create_credit_note(uuid, bigint, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- void_invoice — owner/admin; rejected once any payment exists (record kept)
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before jsonb;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'reason is required' using errcode = '22023';
  end if;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  if not private.is_org_admin(v_inv.org_id) then
    raise exception 'only owner or admin can void invoices' using errcode = '42501';
  end if;

  -- Payment check first so paid invoices fail with the payment rule, not status.
  if exists (
    select 1 from public.payments p where p.invoice_id = v_inv.id
  ) then
    raise exception 'cannot void an invoice that has payments'
      using errcode = '55000';
  end if;

  if v_inv.status is distinct from 'issued' then
    raise exception 'only issued invoices can be voided' using errcode = '22023';
  end if;

  v_before := jsonb_build_object(
    'status', v_inv.status,
    'total_cents', v_inv.total_cents,
    'voided_at', v_inv.voided_at,
    'balance_cents', private.invoice_balance_cents(v_inv.id)
  );

  update public.invoices
  set status = 'void', voided_at = now()
  where id = v_inv.id;

  insert into public.billing_events (org_id, invoice_id, kind, payload)
  values (
    v_inv.org_id,
    v_inv.id,
    'invoice.voided',
    jsonb_build_object(
      'actor_id', v_uid,
      'reason', v_reason,
      'before', v_before,
      'after', jsonb_build_object(
        'status', 'void',
        'total_cents', v_inv.total_cents,
        'voided_at', now(),
        'balance_cents', 0
      )
    )
  );

  return jsonb_build_object(
    'invoice_id', v_inv.id,
    'status', 'void'
  );
end;
$$;

revoke all on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_office_payment — office cash/check (can_edit_customers)
-- ---------------------------------------------------------------------------
create or replace function public.record_office_payment(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_method public.ledger_payment_method;
  v_balance bigint;
  v_payment_id uuid;
  v_before jsonb;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'payment amount must be positive' using errcode = '22023';
  end if;

  if v_reason is null then
    raise exception 'reason is required' using errcode = '22023';
  end if;

  if p_method is distinct from 'cash' and p_method is distinct from 'check' then
    raise exception 'office payment method must be cash or check' using errcode = '22023';
  end if;

  v_method := p_method::public.ledger_payment_method;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  if not private.can_edit_customers(v_inv.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_inv.status is distinct from 'issued' then
    raise exception 'payments require an issued invoice' using errcode = '22023';
  end if;

  v_balance := private.invoice_balance_cents(v_inv.id);
  if p_amount_cents > v_balance then
    raise exception 'payment exceeds invoice balance' using errcode = '22023';
  end if;

  v_before := jsonb_build_object(
    'invoice_status', v_inv.status,
    'invoice_balance_cents', v_balance,
    'paid_at', v_inv.paid_at
  );

  insert into public.payments (
    org_id, account_id, invoice_id, amount_cents, currency, status, method,
    received_at, note
  ) values (
    v_inv.org_id, v_inv.account_id, v_inv.id, p_amount_cents, v_inv.currency,
    'succeeded', v_method, now(), v_reason
  ) returning id into v_payment_id;

  perform private.maybe_mark_invoice_paid(v_inv.id);

  select status, paid_at into v_inv.status, v_inv.paid_at
  from public.invoices
  where id = v_inv.id;

  insert into public.billing_events (
    org_id, invoice_id, payment_id, kind, payload
  ) values (
    v_inv.org_id,
    v_inv.id,
    v_payment_id,
    'payment.office_recorded',
    jsonb_build_object(
      'actor_id', v_uid,
      'reason', v_reason,
      'before', v_before,
      'after', jsonb_build_object(
        'payment_id', v_payment_id,
        'method', v_method,
        'amount_cents', p_amount_cents,
        'invoice_status', v_inv.status,
        'invoice_balance_cents', private.invoice_balance_cents(v_inv.id),
        'paid_at', v_inv.paid_at
      )
    )
  );

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'method', v_method,
    'amount_cents', p_amount_cents,
    'invoice_id', v_inv.id,
    'invoice_status', v_inv.status,
    'invoice_balance_cents', private.invoice_balance_cents(v_inv.id)
  );
end;
$$;

revoke all on function public.record_office_payment(uuid, bigint, text, text) from public, anon;
grant execute on function public.record_office_payment(uuid, bigint, text, text)
  to authenticated, service_role;
