import type { MapTokens } from "@/lib/crew/map-tokens";

export type VisitPinStop = {
  id: string;
  number: number;
  lat: number | null;
  lng: number | null;
  status: string;
};

export type VisitPinFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { kind: "visit-pin"; id: string; number: number; status: string };
};

export type PlanOutlineFeature = {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: { kind: "plan-outline"; category: string | null; label: string | null };
};

/** Visit pins for the crew map. Independent of imagery tiles. */
export function visitPinFeatures(stops: VisitPinStop[]): { type: "FeatureCollection"; features: VisitPinFeature[] } {
  return {
    type: "FeatureCollection",
    features: stops
      .filter((stop): stop is VisitPinStop & { lat: number; lng: number } => stop.lat != null && stop.lng != null)
      .map((stop) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [stop.lng, stop.lat] as [number, number] },
        properties: {
          kind: "visit-pin" as const,
          id: stop.id,
          number: stop.number,
          status: stop.status,
        },
      })),
  };
}

/**
 * Drawn measurement shapes from crew_day_pack `plan` rows.
 * Used when battery saver hides satellite imagery.
 */
export function planOutlineFeatures(visits: unknown[]): { type: "FeatureCollection"; features: PlanOutlineFeature[] } {
  const features: PlanOutlineFeature[] = [];
  for (const visit of visits) {
    if (!visit || typeof visit !== "object") continue;
    const plan = (visit as { plan?: unknown }).plan;
    if (!Array.isArray(plan)) continue;
    for (const row of plan) {
      if (!row || typeof row !== "object") continue;
      const item = row as { geometry?: unknown; category?: unknown; label?: unknown };
      const geometry = item.geometry;
      if (!geometry || typeof geometry !== "object") continue;
      if (!isGeometry(geometry)) continue;
      features.push({
        type: "Feature",
        geometry,
        properties: {
          kind: "plan-outline",
          category: typeof item.category === "string" ? item.category : null,
          label: typeof item.label === "string" ? item.label : null,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function isGeometry(value: unknown): value is GeoJSON.Geometry {
  if (!value || typeof value !== "object") return false;
  const geom = value as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  if (typeof geom.type !== "string") return false;
  if (geom.type === "GeometryCollection") return Array.isArray(geom.geometries);
  return geom.coordinates != null;
}

/** Visible pin disc — sized so a 14px stop number fits. */
export function visitPinPaint(tokens: MapTokens) {
  return {
    "circle-radius": 14,
    "circle-color": [
      "match",
      ["get", "status"],
      "completed",
      tokens.mutedForeground,
      "in_progress",
      tokens.primary,
      "paused",
      tokens.primary,
      tokens.brass,
    ],
    "circle-stroke-color": tokens.pinLabel,
    "circle-stroke-width": 2,
  };
}

/** Invisible 48px hit target over each pin. */
export function visitPinHitPaint() {
  return {
    "circle-radius": 24,
    "circle-color": tokensTransparent,
    "circle-opacity": 0,
  };
}

const tokensTransparent = "rgba(0,0,0,0)";

export function visitPinLabelLayout() {
  return {
    "text-field": ["get", "number"] as unknown as string,
    "text-size": 14,
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  };
}

export function visitPinLabelPaint(tokens: MapTokens) {
  return {
    "text-color": tokens.pinLabel,
  };
}

export function planOutlinePaint(tokens: MapTokens) {
  return {
    fill: { "fill-color": tokens.brass, "fill-opacity": 0.18 },
    line: { "line-color": tokens.brass, "line-width": 2 },
  };
}

export const VISIT_PIN_HIT_LAYER = "visit-pins-hit";
export const VISIT_PIN_LAYER = "visit-pins";
export const VISIT_PIN_LABEL_LAYER = "visit-pin-numbers";
