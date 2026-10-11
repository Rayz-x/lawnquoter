-- I03 billing review queue (issue #70).
-- Held visits wait for office full / partial / $0 resolution.
-- Unaccepted upsell overrides require a note audited in billing_events.
-- Thin I02 adapter: private.invoice_batch_visit_eligible excludes held visits.

create type public.billing_hold_reason as enum (
  'partly_done',
  'completed_after_cancel',
  'photo_lost',
  'upsell_review'
);

alter table public.visits
  add column billing_held boolean not null default false,
  add column billing_hold_reason public.billing_hold_reason;

alter table public.visits
  add constraint visits_billing_hold_reason_check check (
    (billing_held = false and billing_hold_reason is null)
    or (billing_held = true and billing_hold_reason is not null)
  );

create index visits_org_billing_held_idx
  on public.visits (org_id, billing_held)
  where billing_held = true;

-- Auto-hold when a visit is completed after cancel.
create or replace function private.visits_billing_hold_on_cancel_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.completed_after_cancel
     and not old.completed_after_cancel
     and not new.billing_held
  then
    new.billing_held := true;
    new.billing_hold_reason := 'completed_after_cancel'::public.billing_hold_reason;
  end if;
  return new;
end;
$$;

create trigger visits_billing_hold_on_cancel_complete
  before update of completed_after_cancel on public.visits
  for each row
  execute function private.visits_billing_hold_on_cancel_complete();

revoke all on function private.visits_billing_hold_on_cancel_complete() from public, anon;
grant execute on function private.visits_billing_hold_on_cancel_complete() to authenticated, service_role;

-- I02 adapter: billable batch visits must not be held and not already invoiced.
create or replace function private.invoice_batch_visit_eligible(p_visit_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
begin
  select * into v_visit from public.visits where id = p_visit_id;
  if not found then
    return false;
  end if;
  if v_visit.billing_held then
    return false;
  end if;
  if exists (
    select 1 from public.invoices i
    where i.org_id = v_visit.org_id
      and i.visit_id = v_visit.id
  ) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function private.invoice_batch_visit_eligible(uuid) from public, anon;
grant execute on function private.invoice_batch_visit_eligible(uuid) to authenticated, service_role;

-- Price a visit task from its source quote line (dollars → cents).
-- Clamps through public.billable_line_amount_cents so accepted change-order caps apply.
create or replace function private.visit_task_bill_cents(p_task_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line_id uuid;
  v_price numeric;
  v_actual bigint;
begin
  select li.id, li.price
    into v_line_id, v_price
  from public.visit_tasks t
  join public.quote_line_items li on li.id = t.source_line_item_id
  where t.id = p_task_id;

  if not found or v_line_id is null then
    return 0;
  end if;

  v_actual := greatest(0, round(coalesce(v_price, 0) * 100)::bigint);
  return public.billable_line_amount_cents(v_line_id, v_actual);
end;
$$;

revoke all on function private.visit_task_bill_cents(uuid) from public, anon;
grant execute on function private.visit_task_bill_cents(uuid) to authenticated, service_role;

create or replace function public.hold_visit_for_billing(
  p_visit_id uuid,
  p_reason public.billing_hold_reason
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_org uuid := private.current_org_id();
begin
  if v_org is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_reason is null then
    raise exception 'billing hold reason is required' using errcode = '22023';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from v_org then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.invoices i
    where i.org_id = v_org and i.visit_id = v_visit.id
  ) then
    raise exception 'visit is already billed' using errcode = '22023';
  end if;

  update public.visits
  set billing_held = true,
      billing_hold_reason = p_reason
  where id = v_visit.id;
end;
$$;

revoke all on function public.hold_visit_for_billing(uuid, public.billing_hold_reason)
  from public, anon;
grant execute on function public.hold_visit_for_billing(uuid, public.billing_hold_reason)
  to authenticated, service_role;

create or replace function public.office_billing_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_items jsonb := '[]'::jsonb;
begin
  if v_org is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_read_pricing(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item order by (item ->> 'service_date') nulls last, item ->> 'title'), '[]'::jsonb)
    into v_items
  from (
    select jsonb_build_object(
      'id', v.id,
      'property_id', v.property_id,
      'account_id', p.account_id,
      'account_name', a.name,
      'address_line1', p.address_line1,
      'city', p.city,
      'title', coalesce(j.title, 'Visit'),
      'status', v.status::text,
      'service_date', coalesce(v.completed_at::date, v.scheduled_date, v.occurrence_date),
      'hold_reason', v.billing_hold_reason::text,
      'completed_after_cancel', v.completed_after_cancel,
      'tasks', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'label', t.label,
            'amount_cents', private.visit_task_bill_cents(t.id),
            'done', t.done_at is not null
          )
          order by t.sort, t.created_at
        )
        from public.visit_tasks t
        where t.visit_id = v.id and t.org_id = v.org_id
      ), '[]'::jsonb),
      'upsells', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'tag', e.tag::text,
            'note', e.note,
            'status', e.status::text
          )
          order by e.received_at, e.created_at
        )
        from public.enhancement_requests e
        where e.visit_id = v.id
          and e.org_id = v.org_id
          and e.status = 'new'::public.enhancement_status
          and e.quote_id is null
      ), '[]'::jsonb)
    ) as item
    from public.visits v
    left join public.jobs j on j.id = v.job_id
    left join public.properties p on p.id = v.property_id
    left join public.accounts a on a.id = p.account_id
    where v.org_id = v_org
      and v.billing_held = true
      and not exists (
        select 1 from public.invoices i
        where i.org_id = v.org_id and i.visit_id = v.id
      )
  ) q;

  return jsonb_build_object(
    'count', jsonb_array_length(v_items),
    'items', v_items
  );
end;
$$;

revoke all on function public.office_billing_review_queue() from public, anon;
grant execute on function public.office_billing_review_queue() to authenticated, service_role;

create or replace function public.office_resolve_billing_hold(
  p_visit_id uuid,
  p_resolution text,
  p_visit_task_ids uuid[] default null,
  p_upsell_overrides jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_actor uuid := auth.uid();
  v_visit public.visits;
  v_account uuid;
  v_agreement uuid;
  v_invoice uuid;
  v_resolution text := lower(btrim(coalesce(p_resolution, '')));
  v_overrides jsonb := coalesce(p_upsell_overrides, '[]'::jsonb);
  v_task_ids uuid[] := coalesce(p_visit_task_ids, '{}'::uuid[]);
  v_subtotal bigint := 0;
  v_sort integer := 0;
  v_row record;
  v_override jsonb;
  v_enh public.enhancement_requests;
  v_note text;
  v_amount bigint;
  v_enh_id uuid;
  v_desc text;
begin
  if v_org is null or v_actor is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_resolution not in ('full', 'partial', 'zero') then
    raise exception 'resolution must be full, partial, or zero' using errcode = '22023';
  end if;
  if jsonb_typeof(v_overrides) is distinct from 'array' then
    raise exception 'upsell overrides must be an array' using errcode = '22023';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
  for update;

  if not found or v_visit.org_id is distinct from v_org then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  if not v_visit.billing_held then
    raise exception 'visit is not held for billing review' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.invoices i
    where i.org_id = v_org and i.visit_id = v_visit.id
  ) then
    raise exception 'visit is already billed' using errcode = '22023';
  end if;

  select p.account_id into v_account
  from public.properties p
  where p.id = v_visit.property_id and p.org_id = v_org;
  if v_account is null then
    raise exception 'visit needs a property account' using errcode = '22023';
  end if;

  v_agreement := v_visit.agreement_id;

  -- Validate upsell overrides before writing.
  for v_override in select * from jsonb_array_elements(v_overrides)
  loop
    v_enh_id := nullif(v_override ->> 'enhancement_request_id', '')::uuid;
    v_note := nullif(btrim(coalesce(v_override ->> 'note', '')), '');
    v_amount := coalesce((v_override ->> 'amount_cents')::bigint, 0);
    if v_enh_id is null then
      raise exception 'upsell override needs enhancement_request_id' using errcode = '22023';
    end if;
    if v_note is null then
      raise exception 'upsell override requires a note' using errcode = '22023';
    end if;
    if v_amount < 0 then
      raise exception 'upsell override amount cannot be negative' using errcode = '22023';
    end if;
    select * into v_enh
    from public.enhancement_requests e
    where e.id = v_enh_id
      and e.org_id = v_org
      and e.visit_id = v_visit.id;
    if not found then
      raise exception 'upsell not found on this visit' using errcode = 'P0002';
    end if;
    if v_enh.quote_id is not null or v_enh.status = 'quoted'::public.enhancement_status then
      raise exception 'upsell is already accepted as a quote' using errcode = '22023';
    end if;
  end loop;

  if v_resolution = 'partial' then
    if coalesce(cardinality(v_task_ids), 0) < 1 then
      raise exception 'partial resolution needs at least one visit task' using errcode = '22023';
    end if;
    if exists (
      select 1
      from unnest(v_task_ids) tid
      where not exists (
        select 1 from public.visit_tasks t
        where t.id = tid and t.visit_id = v_visit.id and t.org_id = v_org
      )
    ) then
      raise exception 'partial resolution task is not on this visit' using errcode = '22023';
    end if;
  end if;

  insert into public.invoices (
    org_id, account_id, property_id, visit_id, agreement_id,
    status, source, currency, subtotal_cents, tax_cents, total_cents
  ) values (
    v_org, v_account, v_visit.property_id, v_visit.id, v_agreement,
    'draft', 'visit', 'usd', 0, 0, 0
  )
  returning id into v_invoice;

  if v_resolution = 'full' then
    for v_row in
      select t.id, t.label, t.source_line_item_id, private.visit_task_bill_cents(t.id) as amount_cents
      from public.visit_tasks t
      where t.visit_id = v_visit.id and t.org_id = v_org
      order by t.sort, t.created_at
    loop
      if v_row.amount_cents > 0 then
        insert into public.invoice_lines (
          org_id, invoice_id, description, quantity, unit_price_cents, amount_cents,
          sort, source_visit_task_id, source_line_item_id
        ) values (
          v_org, v_invoice, left(btrim(v_row.label), 400), 1,
          v_row.amount_cents, v_row.amount_cents, v_sort,
          v_row.id, v_row.source_line_item_id
        );
        v_subtotal := v_subtotal + v_row.amount_cents;
        v_sort := v_sort + 1;
      end if;
    end loop;
  elsif v_resolution = 'partial' then
    for v_row in
      select t.id, t.label, t.source_line_item_id, private.visit_task_bill_cents(t.id) as amount_cents
      from public.visit_tasks t
      where t.visit_id = v_visit.id
        and t.org_id = v_org
        and t.id = any (v_task_ids)
      order by t.sort, t.created_at
    loop
      insert into public.invoice_lines (
        org_id, invoice_id, description, quantity, unit_price_cents, amount_cents,
        sort, source_visit_task_id, source_line_item_id
      ) values (
        v_org, v_invoice, left(btrim(v_row.label), 400), 1,
        v_row.amount_cents, v_row.amount_cents, v_sort,
        v_row.id, v_row.source_line_item_id
      );
      v_subtotal := v_subtotal + v_row.amount_cents;
      v_sort := v_sort + 1;
    end loop;
  end if;
  -- zero: no task lines

  for v_override in select * from jsonb_array_elements(v_overrides)
  loop
    v_enh_id := (v_override ->> 'enhancement_request_id')::uuid;
    v_note := btrim(v_override ->> 'note');
    v_amount := (v_override ->> 'amount_cents')::bigint;
    select * into v_enh from public.enhancement_requests where id = v_enh_id;
    v_desc := 'Upsell: ' || v_enh.tag::text;

    insert into public.invoice_lines (
      org_id, invoice_id, description, quantity, unit_price_cents, amount_cents, sort
    ) values (
      v_org, v_invoice, left(v_desc, 400), 1, v_amount, v_amount, v_sort
    );
    v_subtotal := v_subtotal + v_amount;
    v_sort := v_sort + 1;

    insert into public.billing_events (org_id, invoice_id, kind, payload)
    values (
      v_org,
      v_invoice,
      'upsell.override',
      jsonb_build_object(
        'visit_id', v_visit.id,
        'enhancement_request_id', v_enh.id,
        'tag', v_enh.tag::text,
        'actor_id', v_actor,
        'amount_cents_before', 0,
        'amount_cents_after', v_amount,
        'note', v_note,
        'reason', v_note
      )
    );
  end loop;

  update public.invoices
  set subtotal_cents = v_subtotal,
      tax_cents = 0,
      total_cents = v_subtotal
  where id = v_invoice;

  update public.visits
  set billing_held = false,
      billing_hold_reason = null
  where id = v_visit.id;

  insert into public.billing_events (org_id, invoice_id, kind, payload)
  values (
    v_org,
    v_invoice,
    'billing_hold.resolved',
    jsonb_build_object(
      'visit_id', v_visit.id,
      'actor_id', v_actor,
      'resolution', v_resolution,
      'hold_reason_before', v_visit.billing_hold_reason::text,
      'visit_task_ids', to_jsonb(v_task_ids),
      'total_cents', v_subtotal
    )
  );

  return jsonb_build_object(
    'invoice_id', v_invoice,
    'total_cents', v_subtotal,
    'resolution', v_resolution
  );
end;
$$;

revoke all on function public.office_resolve_billing_hold(uuid, text, uuid[], jsonb)
  from public, anon;
grant execute on function public.office_resolve_billing_hold(uuid, text, uuid[], jsonb)
  to authenticated, service_role;
