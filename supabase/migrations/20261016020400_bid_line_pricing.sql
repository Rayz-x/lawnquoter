-- Bid line prices follow the office pricing boundary. Crew can walk a package
-- without reading unit prices.

drop policy if exists bid_lines_select on public.bid_lines;
create policy bid_lines_select on public.bid_lines
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));
