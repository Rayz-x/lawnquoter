-- Progress billing: a draw brings the chosen lines up to a percent of their price.
-- Already billed cents (drafts included, voids excluded) are subtracted. The draw never exceeds the line.

create or replace function public.create_progress_invoice(
  p_quote_id uuid,
  p_line_item_ids uuid[],
  p_percent integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_version uuid;
  v_line public.quote_line_items;
  v_found integer;
  v_asked integer;
  v_contract bigint;
  v_billed bigint;
  v_target bigint;
  v_charge bigint;
  v_total bigint := 0;
  v_ids uuid[] := '{}';
  v_amounts bigint[] := '{}';
  v_names text[] := '{}';
  v_invoice uuid;
  v_i integer;
begin
  if p_percent is null or p_percent < 1 or p_percent > 100 then
    raise exception 'percent must be 1 to 100' using errcode = '22023';
  end if;
  if p_line_item_ids is null or cardinality(p_line_item_ids) = 0 then
    raise exception 'choose at least one line' using errcode = '22023';
  end if;

  select * into q from public.quotes where id = p_quote_id for update;
  if not found or q.org_id is distinct from private.current_org_id() then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(q.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if q.status is distinct from 'accepted' then
    raise exception 'quote is not accepted' using errcode = '22023';
  end if;

  select v.id into v_version
  from public.quote_versions v
  where v.quote_id = q.id and v.version = q.current_version;
  if v_version is null then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  select count(distinct x) into v_asked from unnest(p_line_item_ids) as x;
  select count(*) into v_found
  from public.quote_line_items li
  where li.version_id = v_version
    and li.id = any (p_line_item_ids)
    and li.selected = true;
  if v_found is distinct from v_asked then
    raise exception 'line is not on this quote' using errcode = 'P0002';
  end if;

  for v_line in
    select * from public.quote_line_items li
    where li.version_id = v_version
      and li.id = any (p_line_item_ids)
      and li.selected = true
    order by li.sort, li.id
  loop
    v_contract := private.invoice_line_unit_cents(v_line.price, v_line.verified_price, v_line.range_high);
    select coalesce(sum(l.amount_cents), 0) into v_billed
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
    where l.source_line_item_id = v_line.id
      and i.status <> 'void';
    v_target := round(v_contract * p_percent / 100.0)::bigint;
    if v_target > v_contract then
      v_target := v_contract;
    end if;
    v_charge := v_target - v_billed;
    if v_charge < 0 then
      v_charge := 0;
    end if;
    if v_charge = 0 then
      continue;
    end if;
    v_ids := array_append(v_ids, v_line.id);
    v_amounts := array_append(v_amounts, v_charge);
    v_names := array_append(v_names, v_line.name);
    v_total := v_total + v_charge;
  end loop;

  if v_total <= 0 then
    raise exception 'nothing left to bill' using errcode = '22023';
  end if;

  insert into public.invoices (
    org_id, account_id, property_id, status, source, currency,
    subtotal_cents, tax_cents, total_cents, notes
  ) values (
    q.org_id, q.account_id, q.property_id, 'draft', 'progress', 'usd',
    v_total, 0, v_total,
    'Progress billing. This draw brings the selected lines up to ' || p_percent::text || ' percent.'
  ) returning id into v_invoice;

  for v_i in 1 .. cardinality(v_ids) loop
    insert into public.invoice_lines (
      org_id, invoice_id, description, quantity, unit_price_cents, amount_cents, sort, source_line_item_id
    ) values (
      q.org_id, v_invoice,
      left(v_names[v_i], 340) || ' · ' || p_percent::text || '% progress',
      1, v_amounts[v_i], v_amounts[v_i], v_i - 1, v_ids[v_i]
    );
  end loop;

  return v_invoice;
end;
$$;

revoke all on function public.create_progress_invoice(uuid, uuid[], integer) from public, anon;
grant execute on function public.create_progress_invoice(uuid, uuid[], integer) to authenticated, service_role;
