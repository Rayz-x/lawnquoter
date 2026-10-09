export const AREA_CATEGORIES = [
  "turf_front",
  "turf_back",
  "bed",
  "hardscape",
  "driveway",
  "sidewalk",
  "canopy",
  "roof",
] as const;

export const LINE_CATEGORIES = ["edging_line", "fence_line"] as const;

export const FEATURE_CATEGORIES = [...AREA_CATEGORIES, ...LINE_CATEGORIES] as const;
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

export const FEATURE_SOURCES = ["auto", "traced", "manual", "imported"] as const;
export type FeatureSource = (typeof FEATURE_SOURCES)[number];

export const FEATURE_LABELS: Record<FeatureCategory, string> = {
  turf_front: "Front turf",
  turf_back: "Back turf",
  bed: "Bed",
  hardscape: "Hardscape",
  driveway: "Driveway",
  sidewalk: "Sidewalk",
  canopy: "Canopy",
  roof: "Roof",
  edging_line: "Edging",
  fence_line: "Fence",
};

export const FEATURE_COLORS: Record<FeatureCategory, string> = {
  turf_front: "#22c55e",
  turf_back: "#15803d",
  bed: "#ca8a04",
  hardscape: "#78716c",
  driveway: "#44403c",
  sidewalk: "#a8a29e",
  canopy: "#166534",
  roof: "#7f1d1d",
  edging_line: "#eab308",
  fence_line: "#b91c1c",
};

export function isLineCategory(c: FeatureCategory): boolean {
  return (LINE_CATEGORIES as readonly string[]).includes(c);
}

export type ConfidenceBand = "low" | "medium" | "high";

export function confidenceBand(score: number): ConfidenceBand {
  if (score < 0.55) return "low";
  if (score < 0.8) return "medium";
  return "high";
}
