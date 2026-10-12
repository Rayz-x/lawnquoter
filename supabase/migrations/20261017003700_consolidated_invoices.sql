-- One draft for a parent account and its child sites, with the site on each line.
-- Visits already billed, on hold, or not billed per visit are left alone.

create or replace function public.create_consolidated_invoice(
  p_account_id uuid,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts;
  v_visit record;
  v_task record;
  v_invoice uuid;
  v_sort integer := 0;
  v_subtotal bigint := 0;
  v_unit bigint;
  v_amount bigint;
  v_desc text;
  v_visit_count integer := 0;
begin
  if private.current_org_id() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'period_start and period_end are required' using errcode = '22023';
  end if;

  select * into a from public.accounts where id = p_account_id for update;
  if not found or a.org_id is distinct from private.current_org_id() then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(a.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.consolidated_invoicing is not true then
    raise exception 'consolidated invoicing is off' using errcode = '22023';
  end if;

  for v_visit in
    select
      v.id,
      v.property_id,
      coalesce(v.scheduled_date, v.occurrence_date) as service_date,
      coalesce(
        nullif(btrim(p.formatted_address), ''),
        nullif(btrim(concat_ws(', ', nullif(btrim(p.address_line1), ''), nullif(btrim(p.city), ''))), ''),
        'Property'
      ) as property_label
    from public.visits v
    join public.properties p on p.id = v.property_id and p.org_id = v.org_id
    left join public.agreements agr on agr.id = v.agreement_id and agr.org_id = v.org_id
    where v.org_id = a.org_id
      and (
        coalesce(agr.account_id, p.account_id) = a.id
        or coalesce(agr.account_id, p.account_id) in (
          select c.id from public.accounts c
          where c.parent_account_id = a.id and c.org_id = a.org_id
        )
      )
      and (agr.id is null or agr.billing_mode = 'per_visit')
      and v.status = 'completed'::public.visit_status
      and v.billed_invoice_id is null
      and v.billing_hold = false
      and v.completed_after_cancel = false
      and coalesce(v.scheduled_date, v.occurrence_date) between p_period_start and p_period_end
      and exists (
        select 1
        from public.visit_photos ph
        join storage.objects o
          on o.bucket_id = 'visit-photos'
         and o.name = ph.storage_path
        where ph.visit_id = v.id
          and ph.org_id = v.org_id
          and ph.kind = 'after'::public.visit_photo_kind
      )
    order by coalesce(v.scheduled_date, v.occurrence_date), v.sort, v.id
    for update of v
  loop
    if v_invoice is null then
      insert into public.invoices (
        org_id, account_id, status, source, currency,
        subtotal_cents, tax_cents, total_cents, notes
      ) values (
        a.org_id, a.id, 'draft', 'consolidated', 'usd',
        0, 0, 0,
        'Consolidated invoice. Each line names the site.'
      ) returning id into v_invoice;
    end if;

    for v_task in
      select
        t.id as task_id,
        t.label,
        t.source_line_item_id,
        li.name as line_name,
        li.price,
        li.verified_price,
        li.range_high
      from public.visit_tasks t
      join public.quote_line_items li on li.id = t.source_line_item_id
      join public.quote_versions qv on qv.id = li.version_id
      join public.quotes q on q.id = qv.quote_id
      where t.visit_id = v_visit.id
        and t.org_id = a.org_id
        and q.org_id = a.org_id
        and q.status = 'accepted'::public.quote_status
        and li.selected = true
      order by t.sort, t.id
    loop
      v_unit := private.invoice_line_unit_cents(v_task.price, v_task.verified_price, v_task.range_high);
      v_amount := v_unit;
      v_desc := format(
        '%s · %s · %s',
        coalesce(nullif(btrim(v_task.line_name), ''), nullif(btrim(v_task.label), ''), 'Service'),
        v_visit.property_label,
        to_char(v_visit.service_date, 'Mon DD, YYYY')
      );
      insert into public.invoice_lines (
        org_id, invoice_id, description, quantity, unit_price_cents, amount_cents,
        sort, source_visit_task_id, source_line_item_id, visit_id, property_id, service_date
      ) values (
        a.org_id, v_invoice, v_desc, 1, v_unit, v_amount,
        v_sort, v_task.task_id, v_task.source_line_item_id,
        v_visit.id, v_visit.property_id, v_visit.service_date
      );
      v_sort := v_sort + 1;
      v_subtotal := v_subtotal + v_amount;
    end loop;

    update public.visits
    set billed_invoice_id = v_invoice
    where id = v_visit.id
      and org_id = a.org_id
      and billed_invoice_id is null;
    v_visit_count := v_visit_count + 1;
  end loop;

  if v_invoice is null or v_subtotal <= 0 then
    raise exception 'nothing to bill' using errcode = '22023';
  end if;

  update public.invoices
  set subtotal_cents = v_subtotal, tax_cents = 0, total_cents = v_subtotal
  where id = v_invoice;

  insert into public.billing_events (org_id, invoice_id, kind, payload)
  values (
    a.org_id, v_invoice, 'invoice.drafted',
    jsonb_build_object(
      'source', 'consolidated',
      'period_start', p_period_start,
      'period_end', p_period_end,
      'visit_count', v_visit_count
    )
  );

  return v_invoice;
end;
$$;

revoke all on function public.create_consolidated_invoice(uuid, date, date) from public, anon;
grant execute on function public.create_consolidated_invoice(uuid, date, date) to authenticated, service_role;
