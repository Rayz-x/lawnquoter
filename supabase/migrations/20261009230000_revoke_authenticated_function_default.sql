-- 20261009130000 revoked future EXECUTE from anon and PUBLIC only.
-- Hosted still auto-grants EXECUTE on new public functions to authenticated.
-- RPCs that should be callable already have an explicit GRANT.

alter default privileges for role postgres in schema public
  revoke execute on functions from authenticated;
