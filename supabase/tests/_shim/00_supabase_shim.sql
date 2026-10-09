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

-- Tests impersonate anon/authenticated. On the Supabase Postgres image,
-- supabase_auth_admin is reserved and only a superuser may grant membership.
-- The CI login is not a superuser, so ignore that refusal.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin']
  loop
    begin
      execute format('grant %I to current_user', r);
    exception
      when insufficient_privilege then
        null;
      when others then
        if sqlerrm not like '%reserved%' then
          raise;
        end if;
    end;
  end loop;
end
$$;

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
