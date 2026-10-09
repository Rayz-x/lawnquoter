import type { FeatureCategory, FeatureSource, Geometry } from "@lawnquoter/shared";
import { isLineCategory } from "@lawnquoter/shared";
import area from "@turf/area";
import length from "@turf/length";
import { feature } from "@turf/helpers";
import { SQFT_PER_SQM, FT_PER_M } from "@lawnquoter/shared";

export type StudioFeature = {
  clientId: string;
  category: FeatureCategory;
  source: FeatureSource;
  geometry: Geometry | null;
  area_sqft: number | null;
  length_ft: number | null;
  label?: string | null;
  notes?: string | null;
};

export function liveSize(f: StudioFeature): { area_sqft: number | null; length_ft: number | null } {
  if (!f.geometry) return { area_sqft: f.area_sqft, length_ft: f.length_ft };
  if (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") {
    return { area_sqft: Math.round(area(feature(f.geometry)) * SQFT_PER_SQM), length_ft: null };
  }
  if (f.geometry.type === "LineString") {
    return { area_sqft: null, length_ft: Math.round(length(feature(f.geometry), { units: "meters" }) * FT_PER_M) };
  }
  return { area_sqft: f.area_sqft, length_ft: f.length_ft };
}

export function summarize(features: StudioFeature[]) {
  const byCat = new Map<FeatureCategory, { area: number; length: number }>();
  for (const f of features) {
    const size = liveSize(f);
    const cur = byCat.get(f.category) ?? { area: 0, length: 0 };
    cur.area += size.area_sqft ?? 0;
    cur.length += size.length_ft ?? 0;
    byCat.set(f.category, cur);
  }
  const turf = (byCat.get("turf_front")?.area ?? 0) + (byCat.get("turf_back")?.area ?? 0);
  return { byCat, turf };
}

export function newFeature(partial: Omit<StudioFeature, "clientId">): StudioFeature {
  return { clientId: crypto.randomUUID(), ...partial };
}

export function isLine(f: StudioFeature) {
  return isLineCategory(f.category);
}
