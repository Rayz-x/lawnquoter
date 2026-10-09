-- Acceptance records a not-to-exceed cap, a signer email, and the ESIGN
-- disclosure version. Opening a quote no longer marks it viewed.
--
-- DRAFT: pending legal review
-- The not-to-exceed sentence and disclosure version must match
-- apps/web/src/lib/quotes/legal-copy.ts. Edit that file, then add a new
-- migration. Do not change this file after it ships.
--
-- Rebase notes, now applied:
-- * Org branding (PR #6, 20261009120000_org_branding.sql) replaces
--   quote_public and adds org keys: website, logo_url, logo_dark_url,
--   logo_raster_url, logo_width, logo_height, logo_shows_name, logo_needs_chip,
--   heading_font, address_line1, address_line2, city, region, postal_code,
--   country. Those keys are in the org object below. The function stays
--   STABLE, with no FOR UPDATE and no status write, and keeps the
--   acceptance object.
-- * Privilege gaps (PR #10, 20261009130000_privilege_gaps.sql) replace
--   quote_accept and quote_public. quote_accept keeps that migration's
--   request-header capture (p_ip and p_user_agent are ignored). quote_public
--   keeps the crew/crew_lead null check. Grants on quote_accept and
--   quote_public are left as #10 set them. New SECURITY INVOKER helpers are
--   granted to authenticated and service_role because #10 revoked the
--   default EXECUTE that authenticated used to inherit from PUBLIC.
--
-- Already-frozen quotes were hashed without not_to_exceed_clause_template.
-- freeze_quote_version will raise 'proposal changed' until they are revised
-- and sent again. That is intentional: the offer now includes the cap rule.

-- ---------------------------------------------------------------------------
-- Acceptance columns. accepted_total stays the sum of selected point prices.
-- accepted_not_to_exceed is the contractual cap.
-- ---------------------------------------------------------------------------
alter table public.acceptances
  add column accepted_not_to_exceed numeric,
  add column has_ranges boolean not null default false,
  add column not_to_exceed_clause text,
  add column disclosure_version text;

comment on column public.acceptances.accepted_total is
  'Sum of the selected lines'' point prices (the estimate). Not the contractual cap.';
comment on column public.acceptances.accepted_not_to_exceed is
  'Contractual cap: range_high for each selected ranged line, otherwise that line''s point price.';
comment on column public.acceptances.has_ranges is
  'True when any selected line has both range_low and range_high.';
comment on column public.acceptances.not_to_exceed_clause is
  'Exact not-to-exceed sentence the customer agreed to. Null when the selection had no ranges.';
comment on column public.acceptances.disclosure_version is
  'ESIGN disclosure version from apps/web/src/lib/quotes/legal-copy.ts.';

-- Historical rows predate the cap. Treat them as firm prices at the recorded total.
update public.acceptances
set accepted_not_to_exceed = coalesce(accepted_total, 0)
where accepted_not_to_exceed is null;

alter table public.acceptances
  alter column accepted_not_to_exceed set not null;

alter table public.acceptances
  add constraint acceptances_range_clause_chk
  check (
    (has_ranges and not_to_exceed_clause is not null)
    or (not has_ranges and not_to_exceed_clause is null)
  );

-- ---------------------------------------------------------------------------
-- Legal copy used by the hashed offer. DRAFT: pending legal review.
-- ---------------------------------------------------------------------------
create or replace function private.not_to_exceed_clause_template()
returns text
language sql
immutable
set search_path = ''
as $$
  select $clause$You agree to pay no more than {amount}; the final invoice may be lower.$clause$;
$$;

revoke all on function private.not_to_exceed_clause_template() from public, anon;
grant execute on function private.not_to_exceed_clause_template() to authenticated, service_role;

create or replace function private.format_usd(p_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_amount, 'FM$999,999,999,990.00');
$$;

revoke all on function private.format_usd(numeric) from public, anon;
grant execute on function private.format_usd(numeric) to authenticated, service_role;

create or replace function private.not_to_exceed_clause(p_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(private.not_to_exceed_clause_template(), '{amount}', private.format_usd(p_amount));
$$;

revoke all on function private.not_to_exceed_clause(numeric) from public, anon;
grant execute on function private.not_to_exceed_clause(numeric) to authenticated, service_role;

create or replace function private.esign_disclosure_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-10-09-draft'::text;
$$;

revoke all on function private.esign_disclosure_version() from public, anon;
grant execute on function private.esign_disclosure_version() to authenticated, service_role;

-- Signed record: frozen offer hash, selection, cap, clause, and disclosure version.
create or replace function private.acceptance_document_hash(
  p_offer_hash text,
  p_selections jsonb,
  p_not_to_exceed numeric,
  p_has_ranges boolean,
  p_clause text,
  p_disclosure_version text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.sha256_hex(
    p_offer_hash
    || ':' || p_selections::text
    || ':' || trim(to_char(p_not_to_exceed, 'FM999999999990.00'))
    || ':' || p_has_ranges::text
    || ':' || coalesce(p_clause, '')
    || ':' || coalesce(p_disclosure_version, '')
  );
$$;

revoke all on function private.acceptance_document_hash(text, jsonb, numeric, boolean, text, text) from public, anon;
grant execute on function private.acceptance_document_hash(text, jsonb, numeric, boolean, text, text) to authenticated, service_role;

-- Frozen offer. The cap amount depends on the customer's selection, so the
-- template and the pricing rule are what get hashed here. The resolved amount
-- and the rendered sentence are hashed again on the acceptance.
create or replace function private.quote_document_body(p_version uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'quote_id', q.id,
    'version', v.version,
    'title', q.title,
    'intro', q.intro,
    'notes_customer', q.notes_customer,
    'expires_at', q.expires_at,
    'not_to_exceed_clause_template', private.not_to_exceed_clause_template(),
    'not_to_exceed_rule', 'selected lines with a price range use range_high; other selected lines use the point price',
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'description', i.description,
          'state', i.state,
          'option_group', i.option_group,
          'option_tier', i.option_tier,
          'qty', i.qty,
          'unit', i.unit,
          'price', i.price,
          'hours', i.hours,
          'cost', i.cost,
          'range_low', i.range_low,
          'range_high', i.range_high
        )
        order by i.id
      )
      from public.quote_line_items i
      where i.version_id = p_version
    ), '[]'::jsonb)
  )
  from public.quote_versions v
  join public.quotes q on q.id = v.quote_id
  where v.id = p_version;
$$;

-- ---------------------------------------------------------------------------
-- Accept. Same arguments as 20261009041903 so a privilege rebase can keep
-- this body and only change how IP and user agent are supplied.
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

  -- KEEP on rebase (PR #8): IP and user agent come from request headers.
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
    'selections', v_ids
  );
exception
  when unique_violation then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public read is safe. Viewed and expiry are recorded by quote_record_view.
-- A past-due quote still reads as expired so the page can say so immediately.
-- Org branding keys match 20261009120000_org_branding.sql. This replacement
-- stays STABLE and does not lock or update the quote row.
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
begin
  select * into q from public.quotes where public_token = p_token;
  if not found or q.status in ('draft', 'changed') then
    return null;
  end if;

  -- KEEP on rebase (PR #8): crew and crew_lead of this org get null before
  -- any price is built. Anon (auth.uid() is null) still receives the branded
  -- proposal below. This read does not lock the row or write status.
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

  return jsonb_build_object(
    'title', q.title,
    'number', q.number,
    'intro', q.intro,
    'notes_customer', q.notes_customer,
    'expires_at', q.expires_at,
    'status', v_status,
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
        'photo_url', i.photo_url, 'notes_customer', i.notes_customer, 'selected', i.selected, 'sort', i.sort
      ) order by i.sort)
      from public.quote_line_items i where i.version_id = v.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.quote_record_view(p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed', 'accepted', 'declined') then
    return;
  end if;

  if q.expires_at is not null
     and q.expires_at < current_date
     and q.status is distinct from 'expired' then
    update public.quotes set status = 'expired' where id = q.id;
    return;
  end if;

  if q.status = 'expired' then
    return;
  end if;

  if q.status = 'sent' then
    update public.quotes
    set status = 'viewed', viewed_at = coalesce(viewed_at, now())
    where id = q.id;
  end if;
end;
$$;

revoke all on function public.quote_record_view(uuid) from public;
grant execute on function public.quote_record_view(uuid) to anon, authenticated;
