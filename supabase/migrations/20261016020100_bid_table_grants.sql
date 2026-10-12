-- Authenticated has no default table privileges. RLS never runs until the
-- role can see the table, so bid inserts failed with permission denied.

grant select, insert, update, delete on public.bid_packages to authenticated;
grant select, insert, update, delete on public.bid_sites to authenticated;
grant select, insert, update, delete on public.bid_lines to authenticated;
grant select, insert, update, delete on public.site_walk_notes to authenticated;
grant select, insert, update, delete on public.takeoff_imports to authenticated;

grant all on public.bid_packages to service_role;
grant all on public.bid_sites to service_role;
grant all on public.bid_lines to service_role;
grant all on public.site_walk_notes to service_role;
grant all on public.takeoff_imports to service_role;
