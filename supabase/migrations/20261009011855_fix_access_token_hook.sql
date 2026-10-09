-- Auth hook runs as supabase_auth_admin. FORCE RLS blocked that role from
-- reading memberships/profiles, so the SELECT returned no row, jsonb_set
-- received SQL NULL, and the hook returned claims: null — Auth then rejected
-- every sign-in / token refresh.

create policy memberships_select_auth_admin on public.memberships
  as permissive
  for select
  to supabase_auth_admin
  using (true);

create policy profiles_select_auth_admin on public.profiles
  as permissive
  for select
  to supabase_auth_admin
  using (true);

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
  app_meta jsonb;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  if jsonb_typeof(claims) is distinct from 'object' then
    claims := '{}'::jsonb;
  end if;

  select m.org_id, m.role
    into v_org_id, v_role
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  where m.user_id = v_user_id
    and m.status = 'active'
  order by (m.org_id = p.active_org_id) desc nulls last, m.created_at asc
  limit 1;

  app_meta := coalesce(claims -> 'app_metadata', '{}'::jsonb);
  if jsonb_typeof(app_meta) is distinct from 'object' then
    app_meta := '{}'::jsonb;
  end if;

  if v_org_id is not null then
    app_meta := jsonb_set(app_meta, '{org_id}', to_jsonb(v_org_id::text), true);
    app_meta := jsonb_set(app_meta, '{org_role}', to_jsonb(v_role::text), true);
  else
    app_meta := app_meta - 'org_id' - 'org_role';
  end if;

  claims := jsonb_set(claims, '{app_metadata}', app_meta, true);
  return jsonb_build_object('claims', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
