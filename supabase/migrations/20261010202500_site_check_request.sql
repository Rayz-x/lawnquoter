-- Customer "Request a final price" + office approve/decline.
--
-- Dusty: merging applies this migration to the hosted database. Do not merge
-- until Dusty has reviewed and approved it.
--
-- Creates a customer_request site_check (method crew_stop, status requested).
-- Date window is set only when the office approves (default). Rate-limited
-- per token and IP (5/hour). One request per quote version; ≤2 per account
-- in 30 days.

-- ---------------------------------------------------------------------------
-- request_version: ties a customer request to the quote version
-- ---------------------------------------------------------------------------
alter table public.site_checks
  add column request_version integer;

comment on column public.site_checks.request_version is
  'Quote version when a customer_request was created. Blocks a second request on the same version.';

-- ---------------------------------------------------------------------------
-- Rate-limit log (SECURITY DEFINER only; no client grants)
-- ---------------------------------------------------------------------------
create table private.site_check_request_rate (
  id bigint generated always as identity primary key,
  token uuid not null,
  ip inet,
  created_at timestamptz not null default now()
);

create index site_check_request_rate_token_created_idx
  on private.site_check_request_rate (token, created_at desc);
create index site_check_request_rate_ip_created_idx
  on private.site_check_request_rate (ip, created_at desc)
  where ip is not null;

revoke all on table private.site_check_request_rate from public, anon, authenticated;
grant all on table private.site_check_request_rate to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.site_check_request_client_ip()
returns inet
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := '{}'::jsonb;
  v_forwarded text;
  v_ip inet;
begin
  begin
    if coalesce(current_setting('request.headers', true), '') <> '' then
      v_headers := current_setting('request.headers', true)::jsonb;
    end if;
  exception
    when others then
      v_headers := '{}'::jsonb;
  end;

  v_forwarded := nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '');
  if v_forwarded is null then
    return null;
  end if;
  begin
    return v_forwarded::inet;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

revoke all on function private.site_check_request_client_ip() from public, anon;
grant execute on function private.site_check_request_client_ip() to service_role;

create or replace function private.site_check_account_request_count(p_account uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.site_checks sc
  join public.quotes q on q.id = sc.quote_id
  where q.account_id = p_account
    and sc.origin = 'customer_request'::public.site_check_origin
    and sc.created_at >= now() - interval '30 days';
$$;

revoke all on function private.site_check_account_request_count(uuid) from public, anon;
grant execute on function private.site_check_account_request_count(uuid)
  to authenticated, service_role;

-- Attach a nearby visit when approving (crew_stop). Null when none in 7 days.
create or replace function private.site_check_find_nearby_visit(
  p_org uuid,
  p_property uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id
  from public.visits v
  where v.org_id = p_org
    and v.property_id = p_property
    and v.scheduled_date between private.org_local_today(p_org)
                             and private.org_local_today(p_org) + 7
    and v.status not in (
      'cancelled'::public.visit_status,
      'completed'::public.visit_status
    )
  order by v.scheduled_date asc, v.sort asc, v.id asc
  limit 1;
$$;

revoke all on function private.site_check_find_nearby_visit(uuid, uuid) from public, anon;
grant execute on function private.site_check_find_nearby_visit(uuid, uuid)
  to authenticated, service_role;

-- Apply approval (window + scheduled + optional visit). Caller enforces auth.
create or replace function private.site_check_apply_approval(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sc public.site_checks;
  v_today date;
  v_visit uuid;
  v_start date;
  v_end date;
begin
  select * into sc from public.site_checks where id = p_id for update;
  if not found then
    raise exception 'site check not found' using errcode = 'P0002';
  end if;
  if sc.status is distinct from 'requested'::public.site_check_status then
    raise exception 'site check is not awaiting approval' using errcode = '22023';
  end if;

  v_today := private.org_local_today(sc.org_id);
  v_visit := private.site_check_find_nearby_visit(sc.org_id, sc.property_id);

  if v_visit is not null then
    select v.scheduled_date into v_start
    from public.visits v
    where v.id = v_visit;
    v_end := v_start + 2;
  else
    v_start := v_today + 1;
    v_end := v_today + 5;
  end if;

  update public.site_checks
  set
    status = 'scheduled'::public.site_check_status,
    method = 'crew_stop'::public.site_check_method,
    window_start = v_start,
    window_end = v_end,
    visit_id = v_visit,
    due_on = coalesce(v_end, due_on)
  where id = sc.id;

  update public.quotes
  set site_check_status = 'scheduled'::public.site_check_status
  where id = sc.quote_id;

  perform private.append_quote_audit(
    sc.org_id,
    sc.quote_id,
    'site_check.approved',
    jsonb_build_object(
      'site_check_id', sc.id,
      'window_start', v_start,
      'window_end', v_end,
      'visit_id', v_visit
    )
  );

  return jsonb_build_object(
    'ok', true,
    'site_check_id', sc.id,
    'status', 'scheduled',
    'window_start', v_start,
    'window_end', v_end,
    'visit_id', v_visit
  );
end;
$$;

revoke all on function private.site_check_apply_approval(uuid) from public, anon;
grant execute on function private.site_check_apply_approval(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Public: site_check_request
-- ---------------------------------------------------------------------------
create or replace function public.site_check_request(
  p_token uuid,
  p_email text,
  p_note text default null,
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
  v_email text;
  v_note text;
  v_ip inet;
  v_line_ids uuid[];
  v_reasons text[];
  v_measurement uuid;
  v_id uuid;
  v_token_hits integer;
  v_ip_hits integer;
  v_account_hits integer;
begin
  v_email := nullif(btrim(coalesce(p_email, '')), '');
  if v_email is null
     or length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'email required' using errcode = '22023';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  v_ip := private.site_check_request_client_ip();

  select count(*)::integer into v_token_hits
  from private.site_check_request_rate r
  where r.token = p_token
    and r.created_at > now() - interval '1 hour';
  if v_token_hits >= 5 then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;

  if v_ip is not null then
    select count(*)::integer into v_ip_hits
    from private.site_check_request_rate r
    where r.ip = v_ip
      and r.created_at > now() - interval '1 hour';
    if v_ip_hits >= 5 then
      raise exception 'rate limit exceeded' using errcode = 'P0001';
    end if;
  end if;

  insert into private.site_check_request_rate (token, ip)
  values (p_token, v_ip);

  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed', 'declined', 'accepted', 'expired') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.expires_at is not null and q.expires_at < current_date then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.property_id is null then
    raise exception 'quote has no property' using errcode = '22023';
  end if;

  select * into v
  from public.quote_versions
  where quote_id = q.id and version = q.current_version
  for update;

  if exists (
    select 1
    from public.site_checks sc
    where sc.quote_id = q.id
      and sc.origin = 'customer_request'::public.site_check_origin
      and sc.request_version = q.current_version
  ) then
    raise exception 'a final price was already requested on this quote version'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.site_checks sc
    where sc.quote_id = q.id
      and sc.status in (
        'requested'::public.site_check_status,
        'open'::public.site_check_status,
        'scheduled'::public.site_check_status
      )
  ) then
    raise exception 'a site check is already open on this quote' using errcode = '22023';
  end if;

  v_account_hits := private.site_check_account_request_count(q.account_id);
  if v_account_hits >= 2 then
    raise exception 'account request limit reached' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(i.id order by i.id), '{}'::uuid[])
  into v_line_ids
  from private.resolve_quote_selection(v.id, p_selected) s
  join public.quote_line_items i on i.id = s.item_id
  where i.range_low is not null
    and i.range_high is not null;

  if coalesce(cardinality(v_line_ids), 0) = 0 then
    raise exception 'no ranged lines selected' using errcode = '22023';
  end if;

  select coalesce(
    array_agg(distinct r order by r),
    array['customer_request']::text[]
  )
  into v_reasons
  from (
    select unnest(i.site_check_reasons) as r
    from public.quote_line_items i
    where i.id = any (v_line_ids)
    union all
    select 'customer_request'::text
  ) reasons(r)
  where r is not null and btrim(r) <> '';

  select m.id
  into v_measurement
  from public.measurements m
  where m.property_id = q.property_id
    and m.org_id = q.org_id
    and m.status = 'current'
  order by m.created_at desc
  limit 1;

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
    due_on,
    requested_email,
    request_note,
    request_version
  ) values (
    q.org_id,
    q.id,
    q.property_id,
    v_measurement,
    'requested',
    'customer_request',
    'crew_stop',
    v_reasons,
    v_line_ids,
    private.org_local_today(q.org_id) + 5,
    v_email,
    v_note,
    q.current_version
  )
  returning id into v_id;

  update public.quotes
  set site_check_status = 'requested'::public.site_check_status
  where id = q.id;

  perform private.append_quote_audit(
    q.org_id,
    q.id,
    'site_check.requested',
    jsonb_build_object(
      'site_check_id', v_id,
      'email', v_email,
      'version', q.current_version,
      'line_ids', to_jsonb(v_line_ids)
    )
  );

  -- Default: office approves. Auto-approve remains off unless org setting is on.
  if private.site_check_auto_approve(q.org_id) then
    return private.site_check_apply_approval(v_id)
      || jsonb_build_object('auto_approved', true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'site_check_id', v_id,
    'status', 'requested'
  );
end;
$$;

revoke all on function public.site_check_request(uuid, text, text, uuid[]) from public;
grant execute on function public.site_check_request(uuid, text, text, uuid[])
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Office: approve (sets window + scheduled; attaches nearby visit when present)
-- ---------------------------------------------------------------------------
create or replace function public.site_check_approve(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sc public.site_checks;
begin
  if p_id is null then
    raise exception 'site check required' using errcode = '22023';
  end if;

  select * into sc from public.site_checks where id = p_id;
  if not found then
    raise exception 'site check not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(sc.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return private.site_check_apply_approval(p_id);
end;
$$;

revoke all on function public.site_check_approve(uuid) from public, anon;
grant execute on function public.site_check_approve(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Office: decline
-- ---------------------------------------------------------------------------
create or replace function public.site_check_decline(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sc public.site_checks;
  v_reason text;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) > 2000 then
    raise exception 'decline reason required' using errcode = '22023';
  end if;

  select * into sc from public.site_checks where id = p_id for update;
  if not found then
    raise exception 'site check not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(sc.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sc.status is distinct from 'requested'::public.site_check_status then
    raise exception 'site check is not awaiting approval' using errcode = '22023';
  end if;

  update public.site_checks
  set
    status = 'declined'::public.site_check_status,
    decline_reason = v_reason
  where id = sc.id;

  update public.quotes
  set site_check_status = 'declined'::public.site_check_status
  where id = sc.quote_id;

  perform private.append_quote_audit(
    sc.org_id,
    sc.quote_id,
    'site_check.declined',
    jsonb_build_object(
      'site_check_id', sc.id,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'site_check_id', sc.id,
    'status', 'declined'
  );
end;
$$;

revoke all on function public.site_check_decline(uuid, text) from public, anon;
grant execute on function public.site_check_decline(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public: cancel request (until a visit is attached / dispatched)
-- ---------------------------------------------------------------------------
create or replace function public.site_check_cancel_request(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  sc public.site_checks;
begin
  select * into q from public.quotes where public_token = p_token for update;
  if not found then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;

  select * into sc
  from public.site_checks
  where quote_id = q.id
    and origin = 'customer_request'::public.site_check_origin
    and status in (
      'requested'::public.site_check_status,
      'scheduled'::public.site_check_status
    )
  for update;

  if not found then
    raise exception 'no open request' using errcode = 'P0002';
  end if;
  if sc.visit_id is not null and sc.status = 'scheduled'::public.site_check_status then
    raise exception 'request cannot be cancelled after a visit is scheduled'
      using errcode = '22023';
  end if;

  update public.site_checks
  set status = 'cancelled'::public.site_check_status
  where id = sc.id;

  update public.quotes
  set site_check_status = 'cancelled'::public.site_check_status
  where id = q.id;

  perform private.append_quote_audit(
    q.org_id,
    q.id,
    'site_check.cancelled',
    jsonb_build_object('site_check_id', sc.id)
  );

  return jsonb_build_object('ok', true, 'site_check_id', sc.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.site_check_cancel_request(uuid) from public;
grant execute on function public.site_check_cancel_request(uuid)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- quote_public: request state for the customer page
-- ---------------------------------------------------------------------------
create or replace function public.quote_public(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  o public.orgs;
  v_status public.quote_status;
  sc public.site_checks;
  v_account_hits integer;
  v_version_requested boolean;
  v_can_request boolean;
begin
  select * into q from public.quotes where public_token = p_token;
  if not found or q.status in ('draft', 'changed') then
    return null;
  end if;

  if auth.uid() is not null and exists (
    select 1
    from public.memberships m
    where m.org_id = q.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('crew', 'crew_lead')
  ) then
    return null;
  end if;

  v_status := q.status;
  if q.expires_at is not null
     and q.expires_at < current_date
     and q.status not in ('accepted', 'declined', 'expired') then
    v_status := 'expired';
  end if;

  select * into v from public.quote_versions where quote_id = q.id and version = q.current_version;
  select * into o from public.orgs where id = q.org_id;

  select * into sc
  from public.site_checks
  where quote_id = q.id
  order by created_at desc
  limit 1;

  v_account_hits := private.site_check_account_request_count(q.account_id);
  v_version_requested := exists (
    select 1
    from public.site_checks x
    where x.quote_id = q.id
      and x.origin = 'customer_request'::public.site_check_origin
      and x.request_version = q.current_version
  );
  v_can_request :=
    v_status in ('sent', 'viewed')
    and q.property_id is not null
    and not v_version_requested
    and v_account_hits < 2
    and exists (
      select 1
      from public.quote_line_items i
      where i.version_id = v.id
        and i.range_low is not null
        and i.range_high is not null
        and (
          i.state = 'included'::public.item_state
          or i.selected = true
        )
    );

  return jsonb_build_object(
    'title', q.title,
    'number', q.number,
    'intro', q.intro,
    'notes_customer', q.notes_customer,
    'expires_at', q.expires_at,
    'status', v_status,
    'site_check_status', q.site_check_status,
    'site_check', case
      when sc.id is null then null
      else jsonb_build_object(
        'id', sc.id,
        'status', sc.status,
        'origin', sc.origin,
        'window_start', sc.window_start,
        'window_end', sc.window_end,
        'decline_reason', sc.decline_reason,
        'requested_at', sc.created_at,
        'method', sc.method
      )
    end,
    'site_check_can_request', v_can_request,
    'site_check_account_cap_reached', v_account_hits >= 2,
    'org', jsonb_build_object(
      'name', o.name,
      'phone', o.phone,
      'email', o.email,
      'website', o.website,
      'brand_color', o.brand_color,
      'logo_url', o.logo_path,
      'logo_dark_url', o.logo_dark_path,
      'logo_raster_url', o.logo_raster_path,
      'logo_width', o.logo_width,
      'logo_height', o.logo_height,
      'logo_shows_name', o.logo_shows_name,
      'logo_needs_chip', o.logo_needs_chip,
      'heading_font', o.heading_font,
      'address_line1', o.address_line1,
      'address_line2', o.address_line2,
      'city', o.city,
      'region', o.region,
      'postal_code', o.postal_code,
      'country', o.country
    ),
    'acceptance', (
      select jsonb_build_object(
        'document_hash', a.document_hash,
        'accepted_at', a.accepted_at,
        'signer_name', a.signer_name,
        'signer_email', a.signer_email,
        'accepted_total', a.accepted_total,
        'accepted_not_to_exceed', a.accepted_not_to_exceed,
        'has_ranges', a.has_ranges,
        'not_to_exceed_clause', a.not_to_exceed_clause,
        'disclosure_version', a.disclosure_version,
        'selections', a.selections
      )
      from public.acceptances a
      where a.quote_id = q.id
    ),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'sort', s.sort) order by s.sort)
      from public.quote_sections s where s.version_id = v.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'section_id', i.section_id, 'name', i.name, 'description', i.description,
        'state', i.state, 'option_group', i.option_group, 'option_tier', i.option_tier,
        'qty', i.qty, 'unit', i.unit, 'price', i.price, 'range_low', i.range_low, 'range_high', i.range_high,
        'site_check_reasons', i.site_check_reasons,
        'verified_price', i.verified_price, 'verified_at', i.verified_at,
        'photo_url', i.photo_url, 'notes_customer', i.notes_customer, 'selected', i.selected, 'sort', i.sort
      ) order by i.sort)
      from public.quote_line_items i where i.version_id = v.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.quote_public(uuid) from public;
grant execute on function public.quote_public(uuid) to anon, authenticated, service_role;
