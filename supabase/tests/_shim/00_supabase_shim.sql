-- Minimal, idempotent recreation of the Supabase runtime surface that our
-- migrations and RLS policies depend on, so the schema can be tested against a
-- plain Postgres + PostGIS instance (local dev, CI without Docker).
-- Safe to run against a real Supabase database: everything is IF NOT EXISTS.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

-- Do not GRANT these roles here. On the Supabase image postgres is already a
-- member of anon/authenticated/service_role, and repeating the grant crashes
-- the backend. supabase_auth_admin is reserved and cannot be granted.
-- Superusers can SET ROLE without membership; the image's postgres role is already a member.

-- Migrations install PostGIS into this schema. It already exists on the Supabase image.
do $$
begin
  create schema if not exists extensions;
  grant usage on schema extensions to public;
exception
  when insufficient_privilege then
    null;
end
$$;

-- Vanilla Postgres has none of this. The Supabase image already provides an
-- auth schema owned by a reserved role; replacing those functions is refused.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    return;
  end if;

  execute 'create schema if not exists auth';
  execute 'grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin';
  execute $table$
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  $table$;
  execute 'grant select on auth.users to supabase_auth_admin';
  execute $fn$
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $body$
      select nullif(
        coalesce(
          current_setting('request.jwt.claim.sub', true),
          current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
        ),
        ''
      )::uuid
    $body$
  $fn$;
  execute $fn$
    create function auth.jwt()
    returns jsonb
    language sql
    stable
    as $body$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $body$
  $fn$;
  execute $fn$
    create function auth.role()
    returns text
    language sql
    stable
    as $body$
      select nullif(
        coalesce(
          current_setting('request.jwt.claim.role', true),
          current_setting('request.jwt.claims', true)::jsonb ->> 'role'
        ),
        ''
      )::text
    $body$
  $fn$;
  execute 'grant execute on function auth.uid() to public';
  execute 'grant execute on function auth.jwt() to public';
  execute 'grant execute on function auth.role() to public';
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Minimal storage surface for vanilla Postgres. The Supabase image already has
-- these tables, so this block leaves them alone.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    return;
  end if;

  execute 'create schema if not exists storage';
  execute 'grant usage on schema storage to anon, authenticated, service_role';
  execute $table$
    create table storage.buckets (
      id text primary key,
      name text not null,
      owner uuid,
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      public boolean default false,
      avif_autodetection boolean default false,
      file_size_limit bigint,
      allowed_mime_types text[],
      owner_id text
    )
  $table$;
  execute $table$
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets (id),
      name text,
      owner uuid,
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      last_accessed_at timestamptz default now(),
      metadata jsonb,
      version text,
      owner_id text,
      user_metadata jsonb,
      unique (bucket_id, name)
    )
  $table$;
  execute $fn$
    create function storage.foldername(name text)
    returns text[]
    language plpgsql
    as $body$
    declare
      _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1:array_length(_parts, 1) - 1];
    end
    $body$
  $fn$;
  execute 'alter table storage.objects enable row level security';
  execute 'alter table storage.objects force row level security';
  execute 'alter table storage.buckets enable row level security';
  execute 'alter table storage.buckets force row level security';
  execute 'grant select on storage.buckets to anon, authenticated, service_role';
  execute 'grant select, insert, update, delete on storage.objects to authenticated, service_role';
  execute 'grant select on storage.objects to anon';
end
$$;
