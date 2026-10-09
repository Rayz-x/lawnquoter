-- Test helpers for impersonating Supabase users inside a transaction.
create schema if not exists tests;
-- Impersonated roles must still be able to call the helpers to switch back.
grant usage on schema tests to anon, authenticated, service_role;
alter default privileges in schema tests grant execute on functions to anon, authenticated, service_role;

-- Create (or fetch) an auth user by email. Returns the user id.
create or replace function tests.create_user(p_email text, p_full_name text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_id, p_email, jsonb_build_object('full_name', coalesce(p_full_name, p_email)));
  end if;
  -- The on_auth_user_created trigger inserts the profile; make sure it exists
  -- even when the trigger is absent (e.g. shim without migrations).
  insert into public.profiles (id, email, full_name)
  values (v_id, p_email, coalesce(p_full_name, p_email))
  on conflict (id) do nothing;
  return v_id;
end;
$$;

-- Impersonate `authenticated` with the claims our access-token hook produces.
create or replace function tests.authenticate_as(p_user uuid, p_org uuid, p_role public.org_role)
returns void
language plpgsql
as $$
declare
  v_email text;
begin
  -- Reset to the test superuser first so we can read auth.users regardless of
  -- which role the previous impersonation left active.
  perform set_config('role', 'none', true);
  select email into v_email from auth.users where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user::text,
      'role', 'authenticated',
      'email', v_email,
      'app_metadata', jsonb_build_object('org_id', p_org::text, 'org_role', p_role::text)
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Impersonate the anonymous (public, no JWT) role.
create or replace function tests.authenticate_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$$;

-- Back to the superuser running the tests.
create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Create an org owned by p_owner, bypassing RLS (runs as superuser in tests).
create or replace function tests.create_org(p_name text, p_slug text, p_owner uuid)
returns uuid
language plpgsql
as $$
declare
  v_org uuid;
begin
  insert into public.orgs (name, slug) values (p_name, p_slug) returning id into v_org;
  insert into public.memberships (org_id, user_id, role, status)
  values (v_org, p_owner, 'owner', 'active');
  update public.profiles set active_org_id = v_org where id = p_owner;
  return v_org;
end;
$$;

create or replace function tests.add_member(p_org uuid, p_user uuid, p_role public.org_role)
returns void
language plpgsql
as $$
begin
  insert into public.memberships (org_id, user_id, role, status)
  values (p_org, p_user, p_role, 'active')
  on conflict (org_id, user_id) do update set role = excluded.role, status = 'active';
end;
$$;
