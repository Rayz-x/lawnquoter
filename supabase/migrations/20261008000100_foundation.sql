-- Foundation: extensions, private helper schema, orgs, profiles, memberships,
-- tenant-scoped RLS helpers, custom access token hook.
--
-- Conventions used by every later migration:
--   * Every tenant table has `org_id uuid not null references public.orgs(id)`.
--   * RLS is ENABLED and FORCED on every table in `public`.
--   * Policies read the org from the JWT via private.current_org_id(), which is
--     wrapped in (select ...) inside policies for plan caching.
--   * Helpers that must bypass RLS live in schema `private` (not exposed by
--     PostgREST) and set `search_path = ''`.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum (
  'owner', 'admin', 'sales', 'dispatcher', 'crew_lead', 'crew', 'read_only'
);

create type public.membership_status as enum ('invited', 'active', 'disabled');

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Orgs
-- ---------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  timezone text not null default 'America/Chicago',
  currency text not null default 'USD',
  logo_path text,
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  phone text,
  email text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text not null default 'US',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orgs_set_updated_at
  before update on public.orgs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles (mirror of auth.users we can join against)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  avatar_path text,
  active_org_id uuid references public.orgs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Memberships
-- ---------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.org_role not null default 'crew',
  status public.membership_status not null default 'active',
  invited_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_org_id_idx on public.memberships (org_id);

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- JWT / tenant helpers
-- ---------------------------------------------------------------------------
-- Org id from the access token (stamped by the custom access token hook).
create or replace function private.current_org_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id'),
      ''
    ),
    ''
  )::uuid;
$$;

create or replace function private.current_org_role()
returns public.org_role
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_role'),
      ''
    ),
    ''
  )::public.org_role;
$$;

-- True when the caller has an ACTIVE membership in the org named in their JWT
-- and that org equals the row's org. Membership table is checked so that a
-- disabled user is locked out immediately even if their token is still fresh.
create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_org is not null
     and target_org = private.current_org_id()
     and exists (
       select 1
       from public.memberships m
       where m.org_id = target_org
         and m.user_id = auth.uid()
         and m.status = 'active'
     );
$$;

create or replace function private.has_org_role(target_org uuid, allowed public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(target_org)
     and exists (
       select 1
       from public.memberships m
       where m.org_id = target_org
         and m.user_id = auth.uid()
         and m.status = 'active'
         and m.role = any(allowed)
     );
$$;

create or replace function private.is_org_admin(target_org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_org_role(target_org, array['owner','admin']::public.org_role[]);
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid, public.org_role[]) from public;
grant execute on function private.current_org_id() to authenticated, service_role;
grant execute on function private.current_org_role() to authenticated, service_role;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated, service_role;
grant execute on function private.is_org_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Custom access token hook: stamp org_id + org_role into app_metadata.
-- Register in Supabase: Auth > Hooks > Customize Access Token > public.custom_access_token_hook
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  v_user_id uuid;
  v_org_id uuid;
  v_role public.org_role;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  -- Preferred org: the profile's active_org_id if the user is an active member
  -- there, otherwise the earliest active membership.
  select m.org_id, m.role
    into v_org_id, v_role
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  where m.user_id = v_user_id
    and m.status = 'active'
  order by (m.org_id = p.active_org_id) desc nulls last, m.created_at asc
  limit 1;

  if claims ? 'app_metadata' then
    claims := jsonb_set(claims, '{app_metadata,org_id}', to_jsonb(v_org_id::text), true);
    claims := jsonb_set(claims, '{app_metadata,org_role}', to_jsonb(v_role::text), true);
  else
    claims := jsonb_set(
      claims, '{app_metadata}',
      jsonb_build_object('org_id', v_org_id::text, 'org_role', v_role::text), true
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.memberships to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Org bootstrap: create an org and make the caller its owner (used by onboarding)
-- ---------------------------------------------------------------------------
create or replace function public.create_org(p_name text, p_slug text, p_timezone text default 'America/Chicago')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.orgs (name, slug, timezone)
  values (p_name, p_slug, coalesce(p_timezone, 'America/Chicago'))
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role, status)
  values (v_org, v_uid, 'owner', 'active');

  update public.profiles set active_org_id = v_org where id = v_uid;

  return v_org;
end;
$$;

grant execute on function public.create_org(text, text, text) to authenticated;

-- Switch the caller's active org (for users who belong to several orgs).
create or replace function public.set_active_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'not a member of org' using errcode = '42501';
  end if;
  update public.profiles set active_org_id = p_org where id = auth.uid();
end;
$$;

grant execute on function public.set_active_org(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.orgs force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- Orgs: members can read their org; only admins can update; inserts go through create_org().
create policy orgs_select on public.orgs
  for select to authenticated
  using ((select private.is_org_member(id)));

create policy orgs_update on public.orgs
  for update to authenticated
  using ((select private.is_org_admin(id)))
  with check ((select private.is_org_admin(id)));

-- Profiles: a user sees their own profile and profiles of people in their org.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.user_id = public.profiles.id
        and m.org_id = (select private.current_org_id())
        and (select private.is_org_member(m.org_id))
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Memberships: members can see their org's roster; admins manage it.
create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_org_member(org_id)));

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check ((select private.is_org_admin(org_id)));

create policy memberships_update on public.memberships
  for update to authenticated
  using ((select private.is_org_admin(org_id)))
  with check ((select private.is_org_admin(org_id)));

create policy memberships_delete on public.memberships
  for delete to authenticated
  using ((select private.is_org_admin(org_id)) and role <> 'owner');

-- ---------------------------------------------------------------------------
-- Grants: tighten defaults, then grant per table.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

grant select, update on public.orgs to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant all on all tables in schema public to service_role;
