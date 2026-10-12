import type { Geometry } from "@lawnquoter/shared";
import { scoreMeasurementConfidence } from "@/lib/geo/confidence";
import { liveSize, type StudioFeature } from "@/lib/geo/features";
import { prefillTurf } from "@/lib/geo/prefill";
import { lawnSqftFromSides } from "./instant-quote";

export type LawnSizeSource = "trace" | "prefill" | "rectangle";

export type LawnSizeChoice = {
  sqft: number;
  confidence: number;
  source: LawnSizeSource;
};

export type InstantQuoteMap = {
  location: Geometry | null;
  parcel: Geometry | null;
  parcelSource: string | null;
  footprint: Geometry | null;
  footprintSource: string | null;
};

function polygonSqft(geometry: Geometry, source: StudioFeature["source"]): number | null {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;
  const sized = liveSize({
    clientId: "lawn",
    category: "turf_front",
    source,
    geometry,
    area_sqft: null,
    length_ft: null,
  });
  if (sized.area_sqft == null || sized.area_sqft <= 0) return null;
  return sized.area_sqft;
}

/** Trace wins, then parcel minus footprint, then length × width. */
export function chooseLawnSize(input: {
  trace: Geometry | null;
  parcel: Geometry | null;
  parcelSource: string | null;
  footprint: Geometry | null;
  footprintSource: string | null;
  location: Geometry | null;
  lengthFt: number | null;
  widthFt: number | null;
}): LawnSizeChoice | null {
  if (input.trace) {
    const sqft = polygonSqft(input.trace, "traced");
    if (sqft != null) {
      return {
        sqft,
        confidence: scoreMeasurementConfidence({ parcelSource: "traced", footprintSource: "traced" }).score,
        source: "trace",
      };
    }
  }

  const parts = prefillTurf({ parcel: input.parcel, footprint: input.footprint, location: input.location });
  let sqft = 0;
  for (const part of parts) {
    sqft += polygonSqft(part.geometry, "auto") ?? 0;
  }
  if (sqft > 0) {
    return {
      sqft,
      confidence: scoreMeasurementConfidence({
        parcelSource: input.parcelSource,
        footprintSource: input.footprint ? input.footprintSource : null,
      }).score,
      source: "prefill",
    };
  }

  const rectangle = lawnSqftFromSides(input.lengthFt ?? Number.NaN, input.widthFt ?? Number.NaN);
  if (rectangle == null) return null;
  return {
    sqft: rectangle,
    confidence: scoreMeasurementConfidence({ hasManualFallback: true }).score,
    source: "rectangle",
  };
}

export function instantQuoteMapFromGeo(resolved: {
  geocode: { location: Geometry } | null;
  parcel: { geometry: Geometry; source: string } | null;
  footprint: { geometry: Geometry; source: string } | null;
}): InstantQuoteMap {
  return {
    location: resolved.geocode?.location ?? null,
    parcel: resolved.parcel?.geometry ?? null,
    parcelSource: resolved.parcel?.source ?? null,
    footprint: resolved.footprint?.geometry ?? null,
    footprintSource: resolved.footprint?.source ?? null,
  };
}
