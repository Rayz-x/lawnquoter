-- The portal link is a customer credential. Only sales roles can read it.
-- The previous FOR ALL policy also granted SELECT to dispatchers.

drop policy if exists portal_links_select on public.portal_links;
drop policy if exists portal_links_write on public.portal_links;

create policy portal_links_select on public.portal_links
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales']::public.org_role[])));

create policy portal_links_insert on public.portal_links
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));

create policy portal_links_update on public.portal_links
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy portal_links_delete on public.portal_links
  for delete to authenticated
  using ((select private.can_edit_customers(org_id)));
