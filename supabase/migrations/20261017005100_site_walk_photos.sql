-- Private site-walk photos. Keys: {org_id}/{file_id}.{jpg|jpeg|png|webp}
-- Dusty: merging applies this to the hosted database. Do not ALTER storage.objects.

create or replace function private.site_walk_photo_org(object_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org text;
begin
  if object_name is null or split_part(object_name, '/', 3) <> '' then
    return null;
  end if;
  v_org := split_part(object_name, '/', 1);
  if v_org !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  if split_part(object_name, '/', 2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' then
    return null;
  end if;
  return v_org::uuid;
end;
$$;

revoke all on function private.site_walk_photo_org(text) from public, anon;
grant execute on function private.site_walk_photo_org(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-walk-photos',
  'site-walk-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists site_walk_photos_select on storage.objects;
create policy site_walk_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'site-walk-photos'
    and private.is_org_member(private.site_walk_photo_org(name))
  );

drop policy if exists site_walk_photos_insert on storage.objects;
create policy site_walk_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'site-walk-photos'
    and private.site_walk_photo_org(name) is not distinct from private.current_org_id()
    and private.is_org_member(private.current_org_id())
  );

drop policy if exists site_walk_photos_update on storage.objects;
drop policy if exists site_walk_photos_delete on storage.objects;
