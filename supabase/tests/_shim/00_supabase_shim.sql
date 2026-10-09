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

grant anon, authenticated, service_role, supabase_auth_admin to current_user;

create schema if not exists extensions;
grant usage on schema extensions to public;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select on auth.users to supabase_auth_admin;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.role', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'role'
    ),
    ''
  )::text;
$$;

grant execute on function auth.uid() to public;
grant execute on function auth.jwt() to public;
grant execute on function auth.role() to public;

grant usage on schema public to anon, authenticated, service_role;
