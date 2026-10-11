-- I04: issue invoice — gapless INV-YYYY-NNNN, tax at issue, owner/admin only.
-- Additive: per-line taxable, org/property tax rates, issue RPC.
-- Does not create draft-batch RPCs (I02); works with ledger drafts on main.

-- ---------------------------------------------------------------------------
-- Tax rate columns (bps). Company default 0% (TN services to real property).
-- ---------------------------------------------------------------------------
alter table public.orgs
  add column if not exists default_tax_rate_bps integer not null default 0
    check (default_tax_rate_bps >= 0 and default_tax_rate_bps <= 100000);

alter table public.properties
  add column if not exists tax_rate_bps integer
    check (tax_rate_bps is null or (tax_rate_bps >= 0 and tax_rate_bps <= 100000));

alter table public.invoice_lines
  add column if not exists taxable boolean not null default true;

alter table public.invoice_lines
  add column if not exists property_id uuid references public.properties(id) on delete set null;

alter table public.invoice_lines
  add column if not exists tax_rate_bps integer
    check (tax_rate_bps is null or (tax_rate_bps >= 0 and tax_rate_bps <= 100000));

alter table public.invoice_lines
  add column if not exists tax_cents bigint not null default 0 check (tax_cents >= 0);

alter table public.invoices
  add column if not exists number_label text
    check (number_label is null or number_label ~ '^INV-[0-9]{4}-[0-9]{4,}$');

alter table public.invoices
  add column if not exists tax_rate_bps integer
    check (tax_rate_bps is null or (tax_rate_bps >= 0 and tax_rate_bps <= 100000));

alter table public.invoices
  add column if not exists tax_label text;

create index if not exists invoice_lines_property_id_idx
  on public.invoice_lines (property_id)
  where property_id is not null;

create unique index if not exists invoices_org_number_label_key
  on public.invoices (org_id, number_label)
  where number_label is not null;

drop trigger if exists invoice_lines_property_org on public.invoice_lines;
create trigger invoice_lines_property_org
  before insert or update of org_id, property_id on public.invoice_lines
  for each row execute function private.child_org_guard('properties', 'property_id');

-- Issued lock: also freeze number_label / tax snapshots / due_on.
create or replace function private.invoices_issued_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.issued_at is null then
    return new;
  end if;

  if new.subtotal_cents is distinct from old.subtotal_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.total_cents is distinct from old.total_cents
     or new.account_id is distinct from old.account_id
     or new.visit_id is distinct from old.visit_id
     or new.source is distinct from old.source
     or new.currency is distinct from old.currency
     or new.number is distinct from old.number
     or new.number_label is distinct from old.number_label
     or new.tax_rate_bps is distinct from old.tax_rate_bps
     or new.tax_label is distinct from old.tax_label
     or new.issued_at is distinct from old.issued_at
     or new.due_on is distinct from old.due_on
  then
    raise exception 'issued invoice totals and identity are locked'
      using errcode = '55000';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'issued' and new.status in ('paid', 'void'))
      or (old.status = 'paid' and new.status = 'paid')
    ) then
      raise exception 'issued invoice may only move to paid or void'
        using errcode = '55000';
    end if;

    if new.status = 'void' then
      if exists (
        select 1 from public.payments p where p.invoice_id = old.id
      ) then
        raise exception 'cannot void an invoice that has payments'
          using errcode = '55000';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gapless per-company counter (same transaction as issue).
-- ---------------------------------------------------------------------------
create or replace function private.allocate_invoice_number(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
begin
  insert into public.invoice_counters (org_id, next_number)
  values (p_org, 2)
  on conflict (org_id) do update
    set next_number = public.invoice_counters.next_number + 1,
        updated_at = now()
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

revoke all on function private.allocate_invoice_number(uuid) from public, anon, authenticated;
grant execute on function private.allocate_invoice_number(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Issue one draft (may split when line property tax rates differ).
-- ---------------------------------------------------------------------------
create or replace function public.issue_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_org public.orgs;
  v_account public.accounts;
  v_uid uuid := (select auth.uid());
  v_rate_count integer;
  v_keep_rate integer;
  v_other_rate integer;
  v_new_id uuid;
  v_prop uuid;
  v_issued jsonb := '[]'::jsonb;
  v_subtotal bigint;
  v_tax bigint;
  v_line_tax bigint;
  v_number integer;
  v_issued_at timestamptz := now();
  v_issue_date date;
  v_rate integer;
  v_label text;
  v_number_label text;
  r record;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  if not private.is_org_admin(v_inv.org_id) then
    raise exception 'only owner or admin can issue invoices' using errcode = '42501';
  end if;

  if v_inv.status is distinct from 'draft' or v_inv.issued_at is not null then
    raise exception 'only draft invoices can be issued' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.invoice_lines l where l.invoice_id = v_inv.id
  ) then
    raise exception 'invoice has no lines' using errcode = '22023';
  end if;

  select * into v_org from public.orgs where id = v_inv.org_id;
  select * into v_account from public.accounts where id = v_inv.account_id;

  -- Resolve each line's effective tax rate (exempt => 0). Snapshot on the line.
  update public.invoice_lines l
  set
    tax_rate_bps = case
      when v_account.tax_exempt then 0
      when not l.taxable then 0
      else coalesce(
        (
          select p.tax_rate_bps
          from public.properties p
          where p.id = coalesce(l.property_id, v_inv.property_id)
        ),
        v_org.default_tax_rate_bps,
        0
      )
    end
  where l.invoice_id = v_inv.id;

  select count(distinct l.tax_rate_bps)::integer
  into v_rate_count
  from public.invoice_lines l
  where l.invoice_id = v_inv.id;

  -- Split drafts when properties carry different rates.
  if v_rate_count > 1 then
    select min(l.tax_rate_bps) into v_keep_rate
    from public.invoice_lines l
    where l.invoice_id = v_inv.id;

    for v_other_rate in
      select distinct l.tax_rate_bps
      from public.invoice_lines l
      where l.invoice_id = v_inv.id
        and l.tax_rate_bps is distinct from v_keep_rate
      order by 1
    loop
      select l.property_id into v_prop
      from public.invoice_lines l
      where l.invoice_id = v_inv.id
        and l.tax_rate_bps = v_other_rate
      order by l.sort, l.id
      limit 1;

      -- Sibling drafts omit visit_id: unique (org, visit) billed-once stays on
      -- the keeper invoice. Consolidated drafts already have visit_id null.
      insert into public.invoices (
        org_id, account_id, property_id, visit_id, agreement_id,
        status, source, currency, subtotal_cents, tax_cents, total_cents,
        po_number, notes
      ) values (
        v_inv.org_id, v_inv.account_id, v_prop, null, v_inv.agreement_id,
        'draft', v_inv.source, v_inv.currency, 0, 0, 0,
        v_inv.po_number, v_inv.notes
      ) returning id into v_new_id;

      update public.invoice_lines
      set invoice_id = v_new_id
      where invoice_id = v_inv.id
        and tax_rate_bps = v_other_rate;

      v_issued := v_issued || coalesce(public.issue_invoice(v_new_id)->'invoices', '[]'::jsonb);
    end loop;
  end if;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;

  v_issue_date := (timezone(v_org.timezone, v_issued_at))::date;

  v_subtotal := coalesce((
    select sum(l.amount_cents)::bigint
    from public.invoice_lines l
    where l.invoice_id = v_inv.id
  ), 0);

  v_tax := 0;
  for r in
    select l.id, l.amount_cents, l.taxable, l.tax_rate_bps
    from public.invoice_lines l
    where l.invoice_id = v_inv.id
    order by l.sort, l.id
  loop
    if v_account.tax_exempt or not r.taxable or coalesce(r.tax_rate_bps, 0) = 0 then
      v_line_tax := 0;
    else
      v_line_tax := round(r.amount_cents * r.tax_rate_bps / 10000.0)::bigint;
    end if;

    update public.invoice_lines
    set tax_cents = v_line_tax
    where id = r.id;

    v_tax := v_tax + v_line_tax;
  end loop;

  v_rate := coalesce((
    select l.tax_rate_bps
    from public.invoice_lines l
    where l.invoice_id = v_inv.id
    order by l.sort, l.id
    limit 1
  ), v_org.default_tax_rate_bps, 0);

  if v_tax = 0 and upper(coalesce(v_org.region, 'TN')) = 'TN' then
    v_label := 'Tax: $0.00 (services to real property, TN)';
  else
    v_label := 'Tax: $' || to_char(v_tax / 100.0, 'FM999999990.00');
  end if;

  v_number := private.allocate_invoice_number(v_inv.org_id);
  v_number_label :=
    'INV-' || to_char(v_issue_date, 'YYYY') || '-' || lpad(v_number::text, 4, '0');

  update public.invoices
  set
    status = 'issued',
    issued_at = v_issued_at,
    number = v_number,
    number_label = v_number_label,
    subtotal_cents = v_subtotal,
    tax_cents = v_tax,
    total_cents = v_subtotal + v_tax,
    tax_rate_bps = v_rate,
    tax_label = v_label,
    due_on = v_issue_date + coalesce(v_account.net_terms_days, 0)
  where id = v_inv.id;

  insert into public.billing_events (org_id, invoice_id, kind, payload)
  values (
    v_inv.org_id,
    v_inv.id,
    'invoice.issued',
    jsonb_build_object(
      'number', v_number,
      'number_label', v_number_label,
      'tax_cents', v_tax,
      'total_cents', v_subtotal + v_tax,
      'issued_by', v_uid
    )
  );

  v_issued := jsonb_build_array(
    jsonb_build_object(
      'id', v_inv.id,
      'number', v_number,
      'number_label', v_number_label,
      'tax_cents', v_tax,
      'total_cents', v_subtotal + v_tax,
      'tax_label', v_label,
      'due_on', v_issue_date + coalesce(v_account.net_terms_days, 0)
    )
  ) || v_issued;

  return jsonb_build_object('invoices', v_issued);
end;
$$;

revoke all on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated, service_role;
