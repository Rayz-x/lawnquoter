-- I05: Public invoice token page, email, and PDF.
-- public_token is also added by I07 with IF NOT EXISTS — safe either merge order.
-- Hosted apply requires Dusty's OK.

-- ---------------------------------------------------------------------------
-- Token + estimate columns on lines (range display on public page / PDF)
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists invoices_public_token_key
  on public.invoices (public_token);

alter table public.invoice_lines
  add column if not exists estimate_low_cents bigint
    check (estimate_low_cents is null or estimate_low_cents >= 0);

alter table public.invoice_lines
  add column if not exists estimate_high_cents bigint
    check (estimate_high_cents is null or estimate_high_cents >= 0);

alter table public.invoice_lines
  drop constraint if exists invoice_lines_estimate_pair;

alter table public.invoice_lines
  add constraint invoice_lines_estimate_pair check (
    (estimate_low_cents is null and estimate_high_cents is null)
    or (
      estimate_low_cents is not null
      and estimate_high_cents is not null
      and estimate_low_cents <= estimate_high_cents
    )
  );

-- Do not replace private.invoices_issued_lock here — I07 extends it for ACH reopen.
-- public_token defaults at insert and is not rewritten by issue_invoice.

-- ---------------------------------------------------------------------------
-- Public payload for /i/[token] (anon-readable; no draft/void)
-- ---------------------------------------------------------------------------
create or replace function public.invoice_public(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_org public.orgs;
  v_account public.accounts;
begin
  if p_token is null then
    return null;
  end if;

  select * into v_inv
  from public.invoices
  where public_token = p_token;

  if not found then
    return null;
  end if;

  if v_inv.status not in ('issued', 'paid') then
    return null;
  end if;

  select * into v_org from public.orgs where id = v_inv.org_id;
  select * into v_account from public.accounts where id = v_inv.account_id;

  return jsonb_build_object(
    'id', v_inv.id,
    'number', v_inv.number,
    'number_label', v_inv.number_label,
    'status', v_inv.status,
    'currency', v_inv.currency,
    'subtotal_cents', v_inv.subtotal_cents,
    'tax_cents', v_inv.tax_cents,
    'total_cents', v_inv.total_cents,
    'tax_label', v_inv.tax_label,
    'issued_at', v_inv.issued_at,
    'due_on', v_inv.due_on,
    'notes', v_inv.notes,
    'po_number', v_inv.po_number,
    'account_name', v_account.name,
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
    ),
    'lines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'description', l.description,
          'quantity', l.quantity,
          'unit_price_cents', l.unit_price_cents,
          'amount_cents', l.amount_cents,
          'tax_cents', l.tax_cents,
          'estimate_low_cents', l.estimate_low_cents,
          'estimate_high_cents', l.estimate_high_cents,
          'sort', l.sort
        )
        order by l.sort, l.id
      )
      from public.invoice_lines l
      where l.invoice_id = v_inv.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.invoice_public(uuid) from public;
grant execute on function public.invoice_public(uuid) to anon, authenticated, service_role;
