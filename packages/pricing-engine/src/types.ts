import { z } from "zod";

export const QUANTITY_KEYS = [
  "turf_sqft",
  "turf_front_sqft",
  "turf_back_sqft",
  "bed_sqft",
  "hardscape_sqft",
  "driveway_sqft",
  "sidewalk_sqft",
  "edging_lf",
  "fence_lf",
  "canopy_sqft",
  "roof_sqft",
  "lot_sqft",
  "acres",
  "zones",
  "each",
  "hours",
  "visits",
  "inches",
] as const;
export type QuantityKey = (typeof QUANTITY_KEYS)[number];

export type QuantityMap = Partial<Record<QuantityKey, number>> & Record<string, number | undefined>;

export const SLOPES = ["flat", "gentle", "moderate", "steep"] as const;
export type Slope = (typeof SLOPES)[number];

export type PropertyContext = {
  slope?: Slope | null;
  gateWidthIn?: number | null;
  hasStairs?: boolean;
  obstacleCount?: number;
  firstCut?: boolean;
  /** Go iLawn-style complexity slider. 1 = normal. */
  complexity?: number;
  confidence?: number;
};

export type LineBreakdown = { label: string; price: number; hours: number; cost: number };

export type PricedLine = {
  price: number;
  hours: number;
  cost: number;
  range?: { low: number; high: number };
  breakdown: LineBreakdown[];
};

export const tierRowSchema = z.object({
  upTo: z.number().positive().nullable(),
  price: z.number().nonnegative(),
  hours: z.number().nonnegative(),
  cost: z.number().nonnegative(),
});
export type TierRow = z.infer<typeof tierRowSchema>;

export const tierTailSchema = z.object({
  every: z.number().positive(),
  over: z.number().nonnegative(),
  addPrice: z.number(),
  addHours: z.number().nonnegative(),
  addCost: z.number().nonnegative(),
});
export type TierTail = z.infer<typeof tierTailSchema>;

export const tierMatrixRuleSchema = z.object({
  type: z.literal("tier_matrix"),
  quantityKey: z.string(),
  rows: z.array(tierRowSchema).min(1),
  tail: tierTailSchema.optional(),
});
export type TierMatrixRule = z.infer<typeof tierMatrixRuleSchema>;

export const assemblyItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("labor"),
    name: z.string(),
    hourlyRate: z.number().nonnegative(),
    hoursPerUnit: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("equipment"),
    name: z.string(),
    hourlyRate: z.number().nonnegative(),
    hoursPerUnit: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("material"),
    name: z.string(),
    unitCost: z.number().nonnegative(),
    qtyPerUnit: z.number().nonnegative(),
    wastePct: z.number().min(0).max(1).default(0),
  }),
]);
export type AssemblyItem = z.infer<typeof assemblyItemSchema>;

export const assemblyRuleSchema = z.object({
  type: z.literal("assembly"),
  quantityKey: z.string(),
  items: z.array(assemblyItemSchema).min(1),
  overheadPct: z.number().min(0).max(2).default(0),
  targetMarginPct: z.number().min(0).max(0.95).default(0.4),
});
export type AssemblyRule = z.infer<typeof assemblyRuleSchema>;

export const catalogRuleSchema = z.object({
  type: z.literal("catalog"),
  materialCost: z.number().nonnegative(),
  laborCost: z.number().nonnegative(),
  laborHours: z.number().nonnegative().default(0),
  materialMarkupPct: z.number().min(0).max(5).default(0.3),
  laborMarkupPct: z.number().min(0).max(5).default(0.5),
});
export type CatalogRule = z.infer<typeof catalogRuleSchema>;

export const programRuleSchema = z.object({
  type: z.literal("program"),
  applicationCount: z.number().int().positive(),
  perApp: z.object({ price: z.number().nonnegative(), hours: z.number().nonnegative(), cost: z.number().nonnegative() }),
  prepayDiscountPct: z.number().min(0).max(0.5).default(0),
  billing: z.enum(["per_app", "prepay"]).default("per_app"),
});
export type ProgramRule = z.infer<typeof programRuleSchema>;

export const snowRuleSchema = z.object({
  type: z.literal("snow"),
  contract: z.enum(["per_push", "per_inch", "seasonal_flat"]),
  perPush: z.object({ price: z.number().nonnegative(), hours: z.number().nonnegative(), cost: z.number().nonnegative() }).optional(),
  inchTiers: z.array(tierRowSchema).optional(),
  seasonal: z.object({ price: z.number().nonnegative(), hours: z.number().nonnegative(), cost: z.number().nonnegative() }).optional(),
  triggerDepthIn: z.number().nonnegative().default(1),
});
export type SnowRule = z.infer<typeof snowRuleSchema>;

export const irrigationRuleSchema = z.object({
  type: z.literal("irrigation"),
  pricePerZone: z.number().nonnegative(),
  minutesPerZone: z.number().nonnegative(),
  costPerZone: z.number().nonnegative().default(0),
});
export type IrrigationRule = z.infer<typeof irrigationRuleSchema>;

export const pricingRuleSchema = z.discriminatedUnion("type", [
  tierMatrixRuleSchema,
  assemblyRuleSchema,
  catalogRuleSchema,
  programRuleSchema,
  snowRuleSchema,
  irrigationRuleSchema,
]);
export type PricingRule = z.infer<typeof pricingRuleSchema>;

export const modifiersSchema = z.object({
  slope: z
    .record(z.string(), z.object({ pricePct: z.number().default(0), hoursPct: z.number().default(0) }))
    .optional(),
  narrowGateInches: z.number().positive().default(48),
  narrowGate: z.object({ extraHours: z.number().nonnegative(), extraPrice: z.number().nonnegative().default(0) }).optional(),
  firstCut: z.object({ multiplier: z.number().positive() }).optional(),
  perObstacle: z.object({ extraHours: z.number().nonnegative(), extraPrice: z.number().nonnegative() }).optional(),
  minimum: z.object({ price: z.number().nonnegative(), hours: z.number().nonnegative().optional() }).optional(),
  stairs: z.object({ extraHours: z.number().nonnegative(), extraPrice: z.number().nonnegative().default(0) }).optional(),
});
export type Modifiers = z.infer<typeof modifiersSchema>;

export const defaultModifiers = (): Modifiers => ({
  slope: {
    flat: { pricePct: 0, hoursPct: 0 },
    gentle: { pricePct: 0.05, hoursPct: 0.08 },
    moderate: { pricePct: 0.12, hoursPct: 0.2 },
    steep: { pricePct: 0.25, hoursPct: 0.4 },
  },
  narrowGateInches: 48,
  narrowGate: { extraHours: 0.15, extraPrice: 8 },
  firstCut: { multiplier: 1.5 },
  perObstacle: { extraHours: 0.05, extraPrice: 3 },
  minimum: { price: 45, hours: 0.4 },
  stairs: { extraHours: 0.1, extraPrice: 5 },
});

function modifierRecord(stored: unknown): Record<string, unknown> {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return {};
  return stored as Record<string, unknown>;
}

/** Same merge as saving a price list: stored keys win, and `{}` still receives the defaults. */
export function modifiersWithDefaults(stored: unknown): unknown {
  return { ...defaultModifiers(), ...modifierRecord(stored) };
}

export function mergeModifiers(stored: unknown): Modifiers {
  const parsed = modifiersSchema.safeParse(modifiersWithDefaults(stored));
  return parsed.success ? parsed.data : defaultModifiers();
}
