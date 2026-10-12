-- A company created in the app starts on the branding step of setup.
-- Companies that already exist keep settings '{}' and stay finished.

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

  insert into public.orgs (name, slug, timezone, settings)
  values (
    p_name,
    p_slug,
    coalesce(p_timezone, 'America/Chicago'),
    jsonb_build_object('onboarding_step', 'branding')
  )
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role, status)
  values (v_org, v_uid, 'owner', 'active');

  update public.profiles set active_org_id = v_org where id = v_uid;

  return v_org;
end;
$$;
