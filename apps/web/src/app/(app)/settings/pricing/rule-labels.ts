import { priceLine, type Modifiers, type PricingRule, type TierMatrixRule } from "@lawnquoter/pricing-engine";

const LABELS: Record<string, { label: string; unit: string; sample: number; sampleText: string }> = {
  turf_sqft: { label: "Lawn area", unit: "sq ft", sample: 10000, sampleText: "a 10,000 sq ft lawn" },
  turf_front_sqft: { label: "Front lawn area", unit: "sq ft", sample: 5000, sampleText: "a 5,000 sq ft front lawn" },
  turf_back_sqft: { label: "Back lawn area", unit: "sq ft", sample: 5000, sampleText: "a 5,000 sq ft back lawn" },
  bed_sqft: { label: "Bed area", unit: "sq ft", sample: 400, sampleText: "400 sq ft of beds" },
  hardscape_sqft: { label: "Patio and hardscape area", unit: "sq ft", sample: 300, sampleText: "300 sq ft of hardscape" },
  driveway_sqft: { label: "Driveway area", unit: "sq ft", sample: 600, sampleText: "a 600 sq ft driveway" },
  sidewalk_sqft: { label: "Sidewalk area", unit: "sq ft", sample: 200, sampleText: "200 sq ft of sidewalk" },
  edging_lf: { label: "Edging length", unit: "ft", sample: 200, sampleText: "200 ft of edging" },
  fence_lf: { label: "Fence length", unit: "ft", sample: 150, sampleText: "150 ft of fence line" },
  canopy_sqft: { label: "Tree canopy area", unit: "sq ft", sample: 1000, sampleText: "1,000 sq ft of canopy" },
  roof_sqft: { label: "Roof area", unit: "sq ft", sample: 2000, sampleText: "a 2,000 sq ft roof" },
  lot_sqft: { label: "Lot size", unit: "sq ft", sample: 15000, sampleText: "a 15,000 sq ft lot" },
  acres: { label: "Acres", unit: "acres", sample: 1, sampleText: "a 1-acre property" },
  zones: { label: "Sprinkler zones", unit: "zones", sample: 8, sampleText: "an 8-zone system" },
  each: { label: "Count", unit: "items", sample: 10, sampleText: "10 items" },
  hours: { label: "Hours", unit: "hours", sample: 2, sampleText: "2 hours" },
  visits: { label: "Visits", unit: "visits", sample: 4, sampleText: "4 visits" },
  inches: { label: "Snow depth", unit: "in", sample: 4, sampleText: "4 in of snow" },
};

/** Chips offered first in the "Priced by" picker. */
export const COMMON_QUANTITIES = ["turf_sqft", "bed_sqft", "edging_lf", "each", "hours"] as const;

export function quantityLabel(key: string): { label: string; unit: string } {
  const hit = LABELS[key];
  return hit ? { label: hit.label, unit: hit.unit } : { label: "Measured amount", unit: "units" };
}

export const STARTER_TIERS: TierMatrixRule = {
  type: "tier_matrix",
  quantityKey: "turf_sqft",
  rows: [
    { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
    { upTo: 10000, price: 55, hours: 0.75, cost: 24 },
    { upTo: null, price: 70, hours: 1, cost: 32 },
  ],
  tail: { every: 1000, over: 15000, addPrice: 5, addHours: 0.08, addCost: 2 },
};

function sampleFor(rule: PricingRule) {
  if (rule.type === "tier_matrix" || rule.type === "assembly") return LABELS[rule.quantityKey] ?? LABELS.each!;
  if (rule.type === "irrigation") return LABELS.zones!;
  if (rule.type === "snow") return LABELS.inches!;
  return { sample: 0, sampleText: "one property" };
}

/** "Example: a 10,000 sq ft lawn costs $55", priced by the same engine as quotes. */
export function ruleExample(rule: PricingRule, modifiers: Modifiers): { text: string; price: number } {
  const s = sampleFor(rule);
  const key = rule.type === "tier_matrix" || rule.type === "assembly" ? rule.quantityKey : rule.type === "irrigation" ? "zones" : "inches";
  const priced = priceLine({ rule, quantities: { [key]: s.sample }, modifiers, context: {} });
  return { text: s.sampleText, price: priced.price };
}
