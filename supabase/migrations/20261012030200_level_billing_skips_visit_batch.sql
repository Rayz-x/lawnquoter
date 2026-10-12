-- Level-billed agreements are not also billed per visit.
-- Same create_invoices_batch as 20261010210000, plus the level skip.

create or replace function public.create_invoices_batch(
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_account uuid;
  v_invoice uuid;
  v_visit record;
  v_task record;
  v_sort integer;
  v_subtotal bigint;
  v_unit bigint;
  v_amount bigint;
  v_service_date date;
  v_desc text;
  v_property_label text;
  v_invoice_ids uuid[] := '{}';
  v_visit_count integer := 0;
  v_created boolean;
begin
  if v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'period_start and period_end are required' using errcode = '22023';
  end if;

  for v_account in
    select distinct coalesce(agr.account_id, p.account_id) as account_id
    from public.visits v
    join public.jobs j on j.id = v.job_id and j.org_id = v.org_id
    join public.properties p on p.id = v.property_id and p.org_id = v.org_id
    left join public.agreements agr on agr.id = v.agreement_id and agr.org_id = v.org_id
    where v.org_id = v_org
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
      and coalesce(agr.account_id, p.account_id) is not null
      and agr.billing_mode is distinct from 'level'
    order by 1
  loop
    v_invoice := null;
    v_created := false;
    v_subtotal := 0;
    v_sort := 0;

    select i.id into v_invoice
    from public.invoices i
    where i.org_id = v_org
      and i.account_id = v_account
      and i.status = 'draft'::public.invoice_status
      and i.source = 'visit'::public.invoice_source
    order by i.created_at
    limit 1
    for update;

    if v_invoice is null then
      insert into public.invoices (
        org_id, account_id, status, source, currency,
        subtotal_cents, tax_cents, total_cents
      ) values (
        v_org, v_account, 'draft', 'visit', 'usd',
        0, 0, 0
      ) returning id into v_invoice;
      v_created := true;
      v_invoice_ids := array_append(v_invoice_ids, v_invoice);
    else
      select coalesce(max(l.sort), -1) + 1 into v_sort
      from public.invoice_lines l
      where l.invoice_id = v_invoice;
      select i.subtotal_cents into v_subtotal
      from public.invoices i
      where i.id = v_invoice;
      if not (v_invoice = any (v_invoice_ids)) then
        v_invoice_ids := array_append(v_invoice_ids, v_invoice);
      end if;
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
      join public.jobs j on j.id = v.job_id and j.org_id = v.org_id
      join public.properties p on p.id = v.property_id and p.org_id = v.org_id
      left join public.agreements agr on agr.id = v.agreement_id and agr.org_id = v.org_id
      where v.org_id = v_org
        and coalesce(agr.account_id, p.account_id) = v_account
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
        and agr.billing_mode is distinct from 'level'
      order by coalesce(v.scheduled_date, v.occurrence_date), v.sort, v.id
      for update of v
    loop
      v_service_date := v_visit.service_date;
      v_property_label := v_visit.property_label;

      for v_task in
        select
          t.id as task_id,
          t.label,
          t.source_line_item_id,
          li.name as line_name,
          li.price,
          li.verified_price,
          li.range_high,
          li.qty
        from public.visit_tasks t
        join public.quote_line_items li on li.id = t.source_line_item_id
        join public.quote_versions qv on qv.id = li.version_id
        join public.quotes q on q.id = qv.quote_id
        where t.visit_id = v_visit.id
          and t.org_id = v_org
          and q.org_id = v_org
          and q.status = 'accepted'::public.quote_status
          and li.selected = true
        order by t.sort, t.id
      loop
        v_unit := private.invoice_line_unit_cents(
          v_task.price,
          v_task.verified_price,
          v_task.range_high
        );
        v_amount := v_unit; -- one visit occurrence per task line
        v_desc := format(
          '%s · %s · %s',
          coalesce(nullif(btrim(v_task.line_name), ''), nullif(btrim(v_task.label), ''), 'Service'),
          v_property_label,
          to_char(v_service_date, 'Mon DD, YYYY')
        );

        insert into public.invoice_lines (
          org_id, invoice_id, description, quantity, unit_price_cents, amount_cents,
          sort, source_visit_task_id, source_line_item_id,
          visit_id, property_id, service_date
        ) values (
          v_org, v_invoice, v_desc, 1, v_unit, v_amount,
          v_sort, v_task.task_id, v_task.source_line_item_id,
          v_visit.id, v_visit.property_id, v_service_date
        );
        v_sort := v_sort + 1;
        v_subtotal := v_subtotal + v_amount;
      end loop;

      update public.visits
      set billed_invoice_id = v_invoice
      where id = v_visit.id
        and org_id = v_org
        and billed_invoice_id is null;

      v_visit_count := v_visit_count + 1;
    end loop;

    update public.invoices
    set subtotal_cents = v_subtotal,
        tax_cents = 0,
        total_cents = v_subtotal
    where id = v_invoice
      and org_id = v_org;

    insert into public.billing_events (org_id, invoice_id, kind, payload)
    values (
      v_org,
      v_invoice,
      'invoice.drafted',
      jsonb_build_object(
        'period_start', p_period_start,
        'period_end', p_period_end,
        'created', v_created
      )
    );
  end loop;

  return jsonb_build_object(
    'invoice_ids', to_jsonb(v_invoice_ids),
    'invoice_count', coalesce(cardinality(v_invoice_ids), 0),
    'visit_count', v_visit_count,
    'period_start', p_period_start,
    'period_end', p_period_end
  );
end;
$$;

revoke all on function public.create_invoices_batch(date, date) from public, anon;
grant execute on function public.create_invoices_batch(date, date) to authenticated, service_role;
