-- Company branding for public quotes and PDFs.
-- Adds org logo columns, the org-branding bucket, and the extra quote_public fields.
-- Derived shades are computed in the app, not stored.
-- settings.hide_powered_by stays in orgs.settings, defaults to absent/false, and is not shown in the UI.
--
-- Rollback (forward-only migrations; run by hand if you need to revert):
--   drop policy if exists org_branding_public_read on storage.objects;
--   drop policy if exists org_branding_admin_insert on storage.objects;
--   drop policy if exists org_branding_admin_update on storage.objects;
--   drop policy if exists org_branding_admin_delete on storage.objects;
--   drop function if exists private.can_write_org_branding(text);
--   delete from storage.buckets where id = 'org-branding';
--   alter table public.orgs
--     drop column if exists logo_dark_path,
--     drop column if exists logo_raster_path,
--     drop column if exists logo_width,
--     drop column if exists logo_height,
--     drop column if exists logo_shows_name,
--     drop column if exists logo_needs_chip,
--     drop column if exists heading_font,
--     drop column if exists branding_updated_at;
--   Then recreate public.quote_public from 20261009030000_quote_integrity.sql
--   (the org object there is name, phone, email, brand_color only).

alter table public.orgs
  add column logo_dark_path text,
  add column logo_raster_path text,
  add column logo_width int,
  add column logo_height int,
  add column logo_shows_name boolean,
  add column logo_needs_chip boolean not null default false,
  add column heading_font text not null default 'classic'
    check (heading_font in ('classic', 'clean', 'sturdy')),
  add column branding_updated_at timestamptz;

-- True when the caller is an owner or admin of the org named by the first folder.
create or replace function private.can_write_org_branding(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select object_name is not null
     and (storage.foldername(object_name))[1] = (private.current_org_id())::text
     and private.is_org_admin(((storage.foldername(object_name))[1])::uuid);
$$;

revoke all on function private.can_write_org_branding(text) from public;
grant execute on function private.can_write_org_branding(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-branding',
  'org-branding',
  true,
  2097152,
  array['image/svg+xml', 'image/png', 'image/jpeg']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;
alter table storage.objects force row level security;

grant usage on schema storage to anon, authenticated;
grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;

drop policy if exists org_branding_public_read on storage.objects;
create policy org_branding_public_read on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'org-branding');

drop policy if exists org_branding_admin_insert on storage.objects;
create policy org_branding_admin_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'org-branding'
    and private.can_write_org_branding(name)
  );

drop policy if exists org_branding_admin_update on storage.objects;
create policy org_branding_admin_update on storage.objects
  for update
  to authenticated
  using (bucket_id = 'org-branding' and private.can_write_org_branding(name))
  with check (bucket_id = 'org-branding' and private.can_write_org_branding(name));

drop policy if exists org_branding_admin_delete on storage.objects;
create policy org_branding_admin_delete on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'org-branding' and private.can_write_org_branding(name));

-- Public quote payload. Branding is live, not frozen into the document hash.
create or replace function public.quote_public(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  o public.orgs;
begin
  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed') then
    return null;
  end if;

  if q.expires_at is not null
     and q.expires_at < current_date
     and q.status not in ('accepted', 'declined', 'expired') then
    update public.quotes set status = 'expired' where id = q.id;
    q.status := 'expired';
  end if;

  select * into v from public.quote_versions where quote_id = q.id and version = q.current_version;
  select * into o from public.orgs where id = q.org_id;

  if q.status = 'sent' then
    update public.quotes
    set status = 'viewed', viewed_at = coalesce(viewed_at, now())
    where id = q.id;
    q.status := 'viewed';
  end if;

  return jsonb_build_object(
    'title', q.title,
    'number', q.number,
    'intro', q.intro,
    'notes_customer', q.notes_customer,
    'expires_at', q.expires_at,
    'status', q.status,
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
