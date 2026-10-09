-- Hosted Supabase installs public.rls_auto_enable() outside this repo.
-- 20261009130000 revoked EXECUTE from PUBLIC and anon only, so the
-- platform grant to authenticated was left in place. Revoke that too.
-- The function is an event trigger, not an RPC: service_role and the
-- postgres owner keep EXECUTE. Guarded so local and CI, which do not
-- have the function, still apply.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
    grant execute on function public.rls_auto_enable() to service_role, postgres;
  end if;
end
$$;
