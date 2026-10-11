-- A quote line's price stays inside its low–high range.
-- Either bound null is not a range (waiveLineSiteCheck clears both).
-- verified_price is intentionally unconstrained.

alter table public.quote_line_items
  add constraint quote_line_items_price_in_range_chk
  check (
    range_low is null
    or range_high is null
    or (
      range_low <= range_high
      and price >= range_low
      and price <= range_high
    )
  );

comment on constraint quote_line_items_price_in_range_chk on public.quote_line_items is
  'When both bounds are set, range_low <= range_high and range_low <= price <= range_high. A null bound skips the check. verified_price is not checked.';
