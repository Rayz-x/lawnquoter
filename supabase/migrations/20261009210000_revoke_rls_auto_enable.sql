-- Hosted Supabase installs public.rls_auto_enable() outside this repo.
-- 20261009130000 revoked EXECUTE from PUBLIC and anon only, so the
-- platform grant to authenticated was left in place. Revoke that too.
-- A non-owner revoke only warns, so fail if authenticated can still
-- call it. Guarded so local and CI, which do not have the function, still apply.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
    if has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') then
      raise exception 'authenticated can still execute public.rls_auto_enable()';
    end if;
  end if;
end
$$;
