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

export function visitPinPaint() {
  return {
    "circle-radius": 8,
    "circle-color": [
      "match",
      ["get", "status"],
      "completed",
      "#88948E",
      "in_progress",
      "#3F7A57",
      "paused",
      "#3F7A57",
      "#C8891C",
    ],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2,
  };
}
