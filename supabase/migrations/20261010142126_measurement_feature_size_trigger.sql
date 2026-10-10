-- measurement_features_before_write derived area and length only on insert
-- and on UPDATE OF geom. A direct update of area_sqft or length_ft stored the
-- caller's number even when a polygon was present. Fire on those columns too
-- so the existing function keeps the geography-derived values.

drop trigger measurement_features_before_write on public.measurement_features;

create trigger measurement_features_before_write
  before insert or update of geom, area_sqft, length_ft on public.measurement_features
  for each row execute function private.measurement_features_before_write();
