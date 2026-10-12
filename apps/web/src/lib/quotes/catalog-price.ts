import {
  SLOPES,
  priceLine,
  pricingRuleSchema,
  type Modifiers,
  type PricedLine,
  type PropertyContext,
  type QuantityMap,
  type Slope,
} from "@lawnquoter/pricing-engine";

export type MeasuredFeature = {
  category: string;
  area_sqft?: number | string | null;
  length_ft?: number | string | null;
};

const QUANTITY_KEY: Record<string, { key: string; field: "area_sqft" | "length_ft" }> = {
  turf_front: { key: "turf_front_sqft", field: "area_sqft" },
  turf_back: { key: "turf_back_sqft", field: "area_sqft" },
  bed: { key: "bed_sqft", field: "area_sqft" },
  hardscape: { key: "hardscape_sqft", field: "area_sqft" },
  driveway: { key: "driveway_sqft", field: "area_sqft" },
  sidewalk: { key: "sidewalk_sqft", field: "area_sqft" },
  edging_line: { key: "edging_lf", field: "length_ft" },
  fence_line: { key: "fence_lf", field: "length_ft" },
  canopy: { key: "canopy_sqft", field: "area_sqft" },
  roof: { key: "roof_sqft", field: "area_sqft" },
};

/** Map a property measurement onto pricing-engine quantity keys. */
export function measurementQuantities(features: readonly MeasuredFeature[], lotSqft?: number | string | null): QuantityMap {
  const quantities: QuantityMap = {};
  const addQty = (key: string, amount: number) => {
    if (!Number.isFinite(amount) || amount === 0) return;
    quantities[key] = (quantities[key] ?? 0) + amount;
  };
  for (const feature of features) {
    const mapped = QUANTITY_KEY[feature.category];
    if (!mapped) continue;
    addQty(mapped.key, Number(feature[mapped.field] ?? 0));
  }
  if (lotSqft) quantities.lot_sqft = Number(lotSqft);
  return quantities;
}

export type PropertyPricingInput = {
  lotSqft?: number | string | null;
  slope?: string | null;
  gateWidthIn?: number | null;
  obstacleCount?: number | null;
  hasStairs?: boolean | null;
  confidence?: number | null;
  driveMinutes?: number | null;
  driveMiles?: number | null;
  nearbyStops?: number | null;
  serviceMonth?: number | null;
};

export function catalogPickerRules<T extends { price_list_id: string }>(
  rules: readonly T[],
  lists: readonly { id: string; status: string }[] | null | undefined,
): T[] {
  const active = new Set((lists ?? []).filter((list) => list.status === "active").map((list) => list.id));
  return rules.filter((rule) => active.has(rule.price_list_id));
}

function finite(value: number | null | undefined): number | undefined {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

/** Month in the company timezone. Falls back to US Central, then UTC. */
export function monthInTimeZone(date: Date, timeZone?: string | null): number {
  const zone = timeZone?.trim() || "America/Chicago";
  try {
    const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "numeric" }).format(date));
    if (month >= 1 && month <= 12) return month;
  } catch {
    /* unknown timezone */
  }
  return date.getUTCMonth() + 1;
}

/** minimum_price on a joined service row, or undefined when the service has no floor. */
export function serviceMinimumPrice(row: unknown): number | undefined {
  if (!row || typeof row !== "object" || !("services" in row)) return undefined;
  const services = (row as { services?: { minimum_price?: number | string | null } | { minimum_price?: number | string | null }[] | null }).services;
  const one = Array.isArray(services) ? services[0] : services;
  return finite(one?.minimum_price == null ? undefined : Number(one.minimum_price));
}

export function propertyPricingContext(input: PropertyPricingInput): PropertyContext {
  const slope = input.slope && (SLOPES as readonly string[]).includes(input.slope) ? (input.slope as Slope) : undefined;
  return {
    slope,
    gateWidthIn: input.gateWidthIn,
    obstacleCount: input.obstacleCount ?? undefined,
    hasStairs: input.hasStairs ?? undefined,
    confidence: input.confidence != null && Number.isFinite(input.confidence) ? input.confidence : undefined,
    driveMinutes: finite(input.driveMinutes),
    driveMiles: finite(input.driveMiles),
    nearbyStops: finite(input.nearbyStops),
    serviceMonth: finite(input.serviceMonth),
  };
}

/** Price one active catalog rule for a property. Callers must not pass a client-supplied price. */
export function priceCatalogLine(input: {
  config: unknown;
  modifiers: Modifiers;
  features: readonly MeasuredFeature[];
  property: PropertyPricingInput | null;
  serviceMinimum?: number | null;
}): { ok: true; priced: PricedLine } | { ok: false; error: string } {
  const parsed = pricingRuleSchema.safeParse(input.config);
  if (!parsed.success) return { ok: false, error: "Pricing rule is not valid" };
  const property = input.property;
  return {
    ok: true,
    priced: priceLine({
      rule: parsed.data,
      quantities: measurementQuantities(input.features, property?.lotSqft),
      context: { ...propertyPricingContext(property ?? {}), serviceMinimum: finite(input.serviceMinimum) },
      modifiers: input.modifiers,
    }),
  };
}
