-- L10 (#125): convert a lead_request into account + contact + property + draft quote.
-- All-or-nothing transaction. Geocode reused from the lead; parcel/footprint left
-- null so the app can queue enrich. Account stays status=lead (Active on accept
-- via S18 / existing automation).

create or replace function public.convert_lead_request(
  p_lead uuid,
  p_account uuid default null,
  p_force_fail boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.lead_requests%rowtype;
  v_org uuid;
  v_account uuid;
  v_property uuid;
  v_quote uuid;
  v_version uuid;
  v_section uuid;
  v_source text;
  v_source_other text;
  v_utm text;
  v_first text;
  v_last text;
  v_addr1 text;
  v_city text;
  v_region text;
  v_postal text;
  v_jwt_role text;
  v_svc record;
  v_sort integer := 0;
  v_linked boolean := false;
begin
  select * into v_lead
  from public.lead_requests
  where id = p_lead
  for update;

  if not found then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  v_org := v_lead.org_id;

  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Idempotent: already converted
  if v_lead.quote_id is not null
     and v_lead.account_id is not null
     and v_lead.property_id is not null then
    return jsonb_build_object(
      'account_id', v_lead.account_id,
      'property_id', v_lead.property_id,
      'quote_id', v_lead.quote_id,
      'measurement_path', '/properties/' || v_lead.property_id::text || '/measure',
      'already_converted', true
    );
  end if;

  if v_lead.status = 'spam'::public.lead_request_status then
    raise exception 'cannot convert spam lead' using errcode = 'P0001';
  end if;

  if v_lead.status = 'lost'::public.lead_request_status then
    raise exception 'cannot convert lost lead' using errcode = 'P0001';
  end if;

  select m.lead_source, m.lead_source_other
  into v_source, v_source_other
  from private.map_lead_source(coalesce(v_lead.source, v_lead.source_other)) m;

  if v_source = 'Other' and (v_source_other is null or btrim(v_source_other) = '') then
    v_source_other := coalesce(nullif(btrim(v_lead.source_other), ''), nullif(btrim(v_lead.source), ''), 'Lead intake');
  end if;

  v_utm := nullif(
    concat_ws(
      E'\n',
      case when v_lead.utm_source is not null then 'utm_source=' || v_lead.utm_source end,
      case when v_lead.utm_medium is not null then 'utm_medium=' || v_lead.utm_medium end,
      case when v_lead.utm_campaign is not null then 'utm_campaign=' || v_lead.utm_campaign end,
      case when v_lead.utm_term is not null then 'utm_term=' || v_lead.utm_term end,
      case when v_lead.utm_content is not null then 'utm_content=' || v_lead.utm_content end
    ),
    ''
  );

  -- Split contact name
  v_first := split_part(btrim(v_lead.contact_name), ' ', 1);
  v_last := nullif(btrim(substr(btrim(v_lead.contact_name), length(v_first) + 1)), '');

  v_addr1 := coalesce(nullif(btrim(v_lead.address_line1), ''), left(btrim(v_lead.address_typed), 200));
  v_city := coalesce(nullif(btrim(v_lead.city), ''), 'Unknown');
  v_region := coalesce(nullif(btrim(v_lead.region), ''), 'Unknown');
  v_postal := coalesce(nullif(btrim(v_lead.postal_code), ''), '00000');

  if p_account is not null then
    select a.id into v_account
    from public.accounts a
    where a.id = p_account
      and a.org_id = v_org;
    if v_account is null then
      raise exception 'account not found in org' using errcode = 'P0002';
    end if;
    v_linked := true;

    -- Copy source/UTM onto linked account when missing
    v_jwt_role := current_setting('request.jwt.claim.role', true);
    if v_source = 'Website form' then
      perform set_config('request.jwt.claim.role', 'service_role', true);
    end if;

    update public.accounts a
    set
      lead_source = coalesce(a.lead_source, v_source),
      lead_source_other = case
        when a.lead_source is null and v_source = 'Other' then v_source_other
        else a.lead_source_other
      end,
      notes = case
        when a.notes is null or btrim(a.notes) = '' then v_utm
        when v_utm is not null and position('utm_source=' in a.notes) = 0
          then a.notes || E'\n' || v_utm
        else a.notes
      end
    where a.id = v_account;

    if v_source = 'Website form' then
      perform set_config('request.jwt.claim.role', coalesce(v_jwt_role, 'authenticated'), true);
    end if;
  else
    -- Website form is system-only for authenticated JWT role; briefly claim service_role.
    v_jwt_role := current_setting('request.jwt.claim.role', true);
    if v_source = 'Website form' then
      perform set_config('request.jwt.claim.role', 'service_role', true);
    end if;

    insert into public.accounts (
      org_id, type, status, name, email, phone,
      lead_source, lead_source_other, notes, created_by
    ) values (
      v_org,
      case when v_lead.is_business then 'commercial'::public.account_type
           else 'residential'::public.account_type end,
      'lead'::public.account_status,
      v_lead.contact_name,
      v_lead.email,
      v_lead.phone,
      v_source,
      v_source_other,
      v_utm,
      auth.uid()
    )
    returning id into v_account;

    if v_source = 'Website form' then
      perform set_config('request.jwt.claim.role', coalesce(v_jwt_role, 'authenticated'), true);
    end if;
  end if;

  if p_force_fail then
    raise exception 'convert_lead_request forced failure' using errcode = 'P0001';
  end if;

  insert into public.contacts (
    org_id, account_id, first_name, last_name, email, phone,
    role, is_primary, sms_opt_in
  ) values (
    v_org, v_account,
    coalesce(v_first, ''),
    coalesce(v_last, ''),
    v_lead.email,
    v_lead.phone,
    'primary'::public.contact_role,
    true,
    v_lead.sms_consent
  );

  insert into public.properties (
    org_id, account_id, address_line1, address_line2, city, region, postal_code, country,
    location, formatted_address, parcel_source, footprint_source
  ) values (
    v_org, v_account, v_addr1, v_lead.address_line2, v_city, v_region, v_postal,
    coalesce(nullif(btrim(v_lead.country), ''), 'US'),
    v_lead.location,
    coalesce(v_lead.geocode_attribution, v_lead.address_typed),
    'unknown'::public.geo_source,
    'unknown'::public.geo_source
  )
  returning id into v_property;

  -- Queue parcel/footprint fetch (geometry enrich) on the shared timeline
  insert into public.activities (
    org_id, account_id, property_id, kind, summary, meta, actor_id
  ) values (
    v_org, v_account, v_property,
    'property.geo_enrich_queued',
    'Parcel and footprint fetch queued',
    jsonb_build_object(
      'geocode_reused', v_lead.location is not null,
      'geocode_score', v_lead.geocode_score
    ),
    auth.uid()
  );

  v_quote := public.quote_create(v_account, v_property, 'Service quote');

  select v.id, s.id
  into v_version, v_section
  from public.quote_versions v
  join public.quote_sections s on s.version_id = v.id
  where v.quote_id = v_quote
    and v.version = 1
  order by s.sort
  limit 1;

  -- Suggested lines from requested services (match org catalog by slug or name)
  if v_lead.services is not null and cardinality(v_lead.services) > 0 then
    for v_svc in
      select distinct on (svc.id)
        svc.id, svc.name
      from unnest(v_lead.services) as req(label)
      join public.services svc
        on svc.org_id = v_org
       and svc.active
       and (
         lower(svc.slug) = lower(btrim(req.label))
         or lower(svc.name) = lower(btrim(req.label))
       )
      order by svc.id
    loop
      insert into public.quote_line_items (
        org_id, version_id, section_id, service_id, name, state, qty, unit, price, sort
      ) values (
        v_org, v_version, v_section, v_svc.id, v_svc.name,
        'included'::public.item_state, 1, 'each', 0, v_sort
      );
      v_sort := v_sort + 1;
    end loop;

    -- Unmatched requested services still appear as suggested manual lines
    for v_svc in
      select btrim(req.label) as name
      from unnest(v_lead.services) as req(label)
      where btrim(req.label) <> ''
        and not exists (
          select 1
          from public.services svc
          where svc.org_id = v_org
            and svc.active
            and (
              lower(svc.slug) = lower(btrim(req.label))
              or lower(svc.name) = lower(btrim(req.label))
            )
        )
    loop
      insert into public.quote_line_items (
        org_id, version_id, section_id, name, state, qty, unit, price, sort
      ) values (
        v_org, v_version, v_section, v_svc.name,
        'recommended'::public.item_state, 1, 'each', 0, v_sort
      );
      v_sort := v_sort + 1;
    end loop;
  end if;

  update public.lead_requests
  set
    account_id = v_account,
    property_id = v_property,
    quote_id = v_quote,
    status = case
      when status in ('new'::public.lead_request_status, 'contacted'::public.lead_request_status)
        then 'quoted'::public.lead_request_status
      else status
    end
  where id = p_lead;

  insert into public.lead_activities (
    org_id, lead_request_id, kind, summary, meta, actor_id
  ) values (
    v_org, p_lead, 'lead.converted',
    case when v_linked then 'Converted (linked account) to draft quote'
         else 'Converted to account, property, and draft quote' end,
    jsonb_build_object(
      'account_id', v_account,
      'property_id', v_property,
      'quote_id', v_quote,
      'linked', v_linked,
      'utm_source', v_lead.utm_source,
      'utm_medium', v_lead.utm_medium,
      'utm_campaign', v_lead.utm_campaign,
      'utm_term', v_lead.utm_term,
      'utm_content', v_lead.utm_content,
      'geocode_reused', v_lead.location is not null,
      'suggested_line_count', v_sort
    ),
    auth.uid()
  );

  insert into public.activities (
    org_id, account_id, property_id, kind, summary, meta, actor_id
  ) values (
    v_org, v_account, v_property, 'lead.converted',
    'Lead converted to draft quote',
    jsonb_build_object('lead_request_id', p_lead, 'quote_id', v_quote),
    auth.uid()
  );

  return jsonb_build_object(
    'account_id', v_account,
    'property_id', v_property,
    'quote_id', v_quote,
    'measurement_path', '/properties/' || v_property::text || '/measure',
    'already_converted', false
  );
end;
$$;

revoke all on function public.convert_lead_request(uuid, uuid, boolean) from public, anon;
grant execute on function public.convert_lead_request(uuid, uuid, boolean) to authenticated, service_role;

comment on function public.convert_lead_request(uuid, uuid, boolean) is
  'L10: convert lead_request → account/contact/property/draft quote in one transaction.';
