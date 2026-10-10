-- Create a site_checks row when the customer accepts flagged lines.
--
-- Dusty: merging applies this migration to the hosted database. Do not merge
-- until Dusty has reviewed and approved it.
--
-- Send never creates a site check. Acceptance creates one (origin acceptance)
-- for selected lines with site_check_reasons, or upgrades an open customer
-- request so the quote never has two open checks.

-- ---------------------------------------------------------------------------
-- Ensure / upgrade the open site check for an accepted selection.
-- Returns the site_checks.id, or null when nothing was flagged.
-- ---------------------------------------------------------------------------
create or replace function private.site_check_ensure_on_acceptance(
  p_org uuid,
  p_quote uuid,
  p_property uuid,
  p_selected jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line_ids uuid[];
  v_reasons text[];
  v_existing public.site_checks;
  v_measurement uuid;
  v_due date;
  v_id uuid;
  v_status public.site_check_status;
begin
  if p_property is null then
    return null;
  end if;

  select coalesce(array_agg(i.id order by i.id), '{}'::uuid[])
  into v_line_ids
  from public.quote_line_items i
  where i.org_id = p_org
    and i.id in (
      select jsonb_array_elements_text(coalesce(p_selected, '[]'::jsonb))::uuid
    )
    and cardinality(i.site_check_reasons) > 0;

  if coalesce(cardinality(v_line_ids), 0) = 0 then
    return null;
  end if;

  select coalesce(array_agg(distinct r order by r), '{}'::text[])
  into v_reasons
  from public.quote_line_items i
  cross join lateral unnest(i.site_check_reasons) as r
  where i.id = any (v_line_ids);

  select m.id
  into v_measurement
  from public.measurements m
  where m.property_id = p_property
    and m.org_id = p_org
    and m.status = 'current'
  order by m.created_at desc
  limit 1;

  v_due := private.org_local_today(p_org) + 5;

  select *
  into v_existing
  from public.site_checks sc
  where sc.quote_id = p_quote
    and sc.status in (
      'requested'::public.site_check_status,
      'open'::public.site_check_status,
      'scheduled'::public.site_check_status
    )
  for update;

  if found then
    v_status := case
      when v_existing.status = 'requested'::public.site_check_status
        then 'open'::public.site_check_status
      else v_existing.status
    end;

    update public.site_checks
    set
      status = v_status,
      line_ids = v_line_ids,
      reasons = v_reasons,
      measurement_id = coalesce(v_existing.measurement_id, v_measurement),
      due_on = coalesce(v_existing.due_on, v_due),
      property_id = p_property
    where id = v_existing.id
    returning id into v_id;

    update public.quotes
    set site_check_status = v_status
    where id = p_quote;

    return v_id;
  end if;

  insert into public.site_checks (
    org_id,
    quote_id,
    property_id,
    measurement_id,
    status,
    origin,
    method,
    reasons,
    line_ids,
    due_on
  ) values (
    p_org,
    p_quote,
    p_property,
    v_measurement,
    'open',
    'acceptance',
    'crew_stop',
    v_reasons,
    v_line_ids,
    v_due
  )
  returning id into v_id;

  update public.quotes
  set site_check_status = 'open'::public.site_check_status
  where id = p_quote;

  return v_id;
end;
$$;

revoke all on function private.site_check_ensure_on_acceptance(uuid, uuid, uuid, jsonb)
  from public, anon;
grant execute on function private.site_check_ensure_on_acceptance(uuid, uuid, uuid, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- quote_accept: same NTE acceptance body, plus site-check creation.
-- ---------------------------------------------------------------------------
create or replace function public.quote_accept(
  p_token uuid,
  p_signer_name text,
  p_signer_email text default null,
  p_disclosure boolean default false,
  p_user_agent text default null,
  p_ip text default null,
  p_selected uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  v_offer_hash text;
  v_hash text;
  v_event_hash text;
  v_ip inet;
  v_ids jsonb;
  v_total numeric;
  v_nte numeric;
  v_has_ranges boolean;
  v_clause text;
  v_email text;
  v_disclosure text;
  v_accepted_at timestamptz;
  v_headers jsonb := '{}'::jsonb;
  v_forwarded text;
  v_ua text;
  v_site_check uuid;
begin
  -- Arguments are ignored so a direct PostgREST call cannot forge evidence.
  perform p_user_agent, p_ip;

  if coalesce(p_disclosure, false) is not true then
    raise exception 'ESIGN disclosure must be accepted' using errcode = '22023';
  end if;
  if p_signer_name is null or length(trim(p_signer_name)) < 2 then
    raise exception 'signer name required' using errcode = '22023';
  end if;
  v_email := nullif(btrim(coalesce(p_signer_email, '')), '');
  if v_email is null
     or length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'signer email required' using errcode = '22023';
  end if;

  begin
    if coalesce(current_setting('request.headers', true), '') <> '' then
      v_headers := current_setting('request.headers', true)::jsonb;
    end if;
  exception
    when others then
      v_headers := '{}'::jsonb;
  end;

  v_forwarded := nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '');
  if v_forwarded is not null then
    begin
      v_ip := v_forwarded::inet;
    exception
      when invalid_text_representation then
        v_ip := null;
    end;
  end if;
  v_ua := nullif(btrim(v_headers ->> 'user-agent'), '');

  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed', 'declined') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.expires_at is not null and q.expires_at < current_date and q.status <> 'accepted' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'expired' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'accepted' then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
  end if;

  select * into v
  from public.quote_versions
  where quote_id = q.id and version = q.current_version
  for update;

  v_offer_hash := private.freeze_quote_version(v.id);

  select
    coalesce(jsonb_agg(s.item_id order by s.item_id), '[]'::jsonb),
    coalesce(sum(s.price), 0),
    coalesce(sum(
      case
        when i.range_low is not null and i.range_high is not null then i.range_high
        else s.price
      end
    ), 0),
    coalesce(bool_or(i.range_low is not null and i.range_high is not null), false)
  into v_ids, v_total, v_nte, v_has_ranges
  from private.resolve_quote_selection(v.id, p_selected) s
  join public.quote_line_items i on i.id = s.item_id;

  v_clause := case when v_has_ranges then private.not_to_exceed_clause(v_nte) else null end;
  v_disclosure := private.esign_disclosure_version();
  v_hash := private.acceptance_document_hash(
    v_offer_hash, v_ids, v_nte, v_has_ranges, v_clause, v_disclosure
  );
  v_accepted_at := now();

  insert into public.acceptances (
    org_id, quote_id, version, method, signer_name, signer_email,
    document_hash, disclosure_accepted, disclosure_version, ip, user_agent, selections,
    accepted_total, accepted_not_to_exceed, has_ranges, not_to_exceed_clause, accepted_at
  ) values (
    q.org_id, q.id, q.current_version, 'click', trim(p_signer_name), v_email,
    v_hash, true, v_disclosure, v_ip, v_ua, v_ids,
    v_total, v_nte, v_has_ranges, v_clause, v_accepted_at
  );

  v_event_hash := private.append_quote_audit(
    q.org_id,
    q.id,
    'quote.accepted',
    jsonb_build_object(
      'signer', trim(p_signer_name),
      'email', v_email,
      'version', q.current_version,
      'document_hash', v_hash,
      'selections', v_ids,
      'accepted_total', v_total,
      'accepted_not_to_exceed', v_nte,
      'has_ranges', v_has_ranges,
      'not_to_exceed_clause', v_clause,
      'disclosure_version', v_disclosure,
      'ip', v_ip::text
    )
  );

  v_site_check := private.site_check_ensure_on_acceptance(
    q.org_id, q.id, q.property_id, v_ids
  );

  update public.quotes set status = 'accepted' where id = q.id;

  return jsonb_build_object(
    'ok', true,
    'document_hash', v_hash,
    'event_hash', v_event_hash,
    'accepted_total', v_total,
    'accepted_not_to_exceed', v_nte,
    'has_ranges', v_has_ranges,
    'not_to_exceed_clause', v_clause,
    'disclosure_version', v_disclosure,
    'signer_email', v_email,
    'accepted_at', v_accepted_at,
    'selections', v_ids,
    'site_check_id', v_site_check
  );
exception
  when unique_violation then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
end;
$$;

-- Grants unchanged from privilege-gaps / NTE (anon + authenticated).
revoke all on function public.quote_accept(uuid, text, text, boolean, text, text, uuid[])
  from public;
grant execute on function public.quote_accept(uuid, text, text, boolean, text, text, uuid[])
  to anon, authenticated, service_role;
