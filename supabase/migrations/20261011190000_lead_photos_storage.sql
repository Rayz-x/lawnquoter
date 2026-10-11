-- L13: Private lead-form photo bucket + office-only read policies.
--
-- Dusty: merging applies this migration to the hosted database. Do not merge
-- until Dusty has reviewed and approved it.
--
-- Object keys: {org_id}/{lead_id}/{file_id}.{jpg|png|webp}
-- Public uploads go through the intake API with the service role after
-- Turnstile passes. Authenticated clients never insert. Crew and anon cannot
-- read objects; office roles (can_read_office_records) can.

-- ---------------------------------------------------------------------------
-- Path parser
-- ---------------------------------------------------------------------------
create or replace function private.lead_photo_path_parts(object_name text)
returns table (org_id uuid, lead_id uuid, file_id uuid, ext text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org text;
  v_lead text;
  v_file text;
  v_stem text;
  v_ext text;
begin
  if object_name is null or position('://' in object_name) > 0 then
    return;
  end if;
  if split_part(object_name, '/', 4) <> '' then
    return;
  end if;

  v_org := split_part(object_name, '/', 1);
  v_lead := split_part(object_name, '/', 2);
  v_file := split_part(object_name, '/', 3);

  if v_org !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_lead !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;

  if v_file !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' then
    return;
  end if;

  v_ext := lower(split_part(v_file, '.', 2));
  if v_ext = 'jpeg' then
    v_ext := 'jpg';
  end if;
  v_stem := left(v_file, length(v_file) - length(v_ext) - 1);

  org_id := v_org::uuid;
  lead_id := v_lead::uuid;
  file_id := v_stem::uuid;
  ext := v_ext;
  return next;
end;
$$;

revoke all on function private.lead_photo_path_parts(text) from public, anon;
grant execute on function private.lead_photo_path_parts(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Office-only read helper
-- ---------------------------------------------------------------------------
create or replace function private.can_read_lead_photo(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_lead uuid;
begin
  select p.org_id, p.lead_id
    into v_org, v_lead
  from private.lead_photo_path_parts(object_name) p;

  if v_org is null or v_lead is null then
    return false;
  end if;
  if v_org is distinct from private.current_org_id() then
    return false;
  end if;
  if not exists (
    select 1
    from public.lead_requests lr
    where lr.id = v_lead
      and lr.org_id = v_org
  ) then
    return false;
  end if;

  return private.can_read_office_records(v_org);
end;
$$;

revoke all on function private.can_read_lead_photo(text) from public, anon;
grant execute on function private.can_read_lead_photo(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private bucket. Do not ALTER storage.objects; hosted Supabase owns it.
-- 2097152 bytes is 2 MiB. Intake validates mime + count before upload.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-photos',
  'lead-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists lead_photos_object_select on storage.objects;
create policy lead_photos_object_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lead-photos'
    and private.can_read_lead_photo(name)
  );

-- No insert/update/delete for authenticated or anon. Intake uses service_role.
drop policy if exists lead_photos_object_insert on storage.objects;
drop policy if exists lead_photos_object_update on storage.objects;
drop policy if exists lead_photos_object_delete on storage.objects;

comment on column public.lead_requests.photo_paths is
  'Storage object keys in the private lead-photos bucket (up to 3).';
