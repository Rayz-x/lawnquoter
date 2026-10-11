-- S21 / #101: Blank gate width is unknown; migrate legacy 0 → null.
-- After this migration, gate_width_in semantics are:
--   null = Unknown
--   0    = No gate
--   >0   = measured width in inches (narrow-gate fee when >0 and below threshold)

update public.properties
set gate_width_in = null
where gate_width_in = 0;

comment on column public.properties.gate_width_in is
  'Gate opening in inches. null = unknown, 0 = no gate, positive = measured width.';
