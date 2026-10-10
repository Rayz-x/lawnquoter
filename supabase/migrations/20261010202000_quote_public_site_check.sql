-- Public proposal payload: site-check fields for customer copy.
--
-- Dusty: merging applies this migration to the hosted database. Do not merge
-- until Dusty has reviewed and approved it.
--
-- Extends quote_public with quotes.site_check_status and per-item
-- site_check_reasons / verified_price / verified_at. Request-window keys
-- land with the request-RPC slice.

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
    'site_check_status', q.site_check_status,
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
