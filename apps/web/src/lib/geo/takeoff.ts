import { FEATURE_CATEGORIES, geometrySchema, type FeatureCategory, type Geometry } from "@lawnquoter/shared";

export type TakeoffFeature = {
  category: FeatureCategory;
  source: "imported";
  geometry: Geometry | null;
  area_sqft: number | null;
  length_ft: number | null;
};

const EMPTY = "No takeoff features found. Use a GeoJSON file, or a CSV with category and area_sqft.";

function categoryOf(value: unknown): FeatureCategory | null {
  return FEATURE_CATEGORIES.find((category) => category === value) ?? null;
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  const next = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(next) && next >= 0 ? next : null;
}

function fromGeoJson(value: unknown): TakeoffFeature[] {
  const record = value as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown };
  const features = record.type === "FeatureCollection" ? record.features ?? [] : record.type === "Feature" ? [record] : [];
  return features.flatMap((item) => {
    const feature = item as { properties?: Record<string, unknown>; geometry?: unknown };
    const category = categoryOf(feature.properties?.category);
    const geometry = geometrySchema.safeParse(feature.geometry);
    if (!category || !geometry.success) return [];
    return [
      {
        category,
        source: "imported" as const,
        geometry: geometry.data,
        area_sqft: finite(feature.properties?.area_sqft),
        length_ft: finite(feature.properties?.length_ft),
      },
    ];
  });
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function fromCsv(text: string): TakeoffFeature[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsv(lines[0]!).map((cell) => cell.toLowerCase().replace(/\s+/g, "_"));
  const categoryIndex = header.findIndex((cell) => cell === "category" || cell === "type");
  const areaIndex = header.findIndex((cell) => cell === "area_sqft" || cell === "sqft" || cell === "area");
  const lengthIndex = header.findIndex((cell) => cell === "length_ft" || cell === "length");
  if (categoryIndex < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const cells = splitCsv(line);
    const category = categoryOf(cells[categoryIndex]);
    const area = areaIndex >= 0 ? finite(cells[areaIndex]) : null;
    const length = lengthIndex >= 0 ? finite(cells[lengthIndex]) : null;
    if (!category || (area == null && length == null)) return [];
    return [{ category, source: "imported" as const, geometry: null, area_sqft: area, length_ft: length }];
  });
}

/** Beam / SiteRecon style file import. GeoJSON keeps the shapes. CSV keeps the sizes. */
export function parseTakeoff(text: string): { ok: true; features: TakeoffFeature[] } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: EMPTY };
  let features: TakeoffFeature[] = [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      features = fromGeoJson(JSON.parse(trimmed) as unknown);
    } catch {
      return { ok: false, error: EMPTY };
    }
  } else {
    features = fromCsv(trimmed);
  }
  if (features.length === 0) return { ok: false, error: EMPTY };
  return { ok: true, features };
}
