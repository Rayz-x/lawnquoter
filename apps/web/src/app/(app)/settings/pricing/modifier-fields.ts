import { modifiersSchema, priceLine, type Modifiers, type PricingRule } from "@lawnquoter/pricing-engine";
import { z } from "zod";

/**
 * Plain, form-friendly view of price list modifiers. Owners edit dollars,
 * percents and minutes; this maps to and from the engine's modifiers JSON.
 */
const money = z.number().min(0).max(10000);
const pct = z.number().min(0).max(200);
const minutes = z.number().min(0).max(600);
const slopes = z.object({ gentle: pct, moderate: pct, steep: pct });

export const modifierFieldsSchema = z.object({
  minimumPrice: money,
  minimumMinutes: minutes,
  slopeOn: z.boolean(),
  slopePct: slopes,
  slopeTimePct: slopes,
  gateOn: z.boolean(),
  gateInches: z.number().min(1).max(240),
  gatePrice: money,
  gateMinutes: minutes,
  firstCutOn: z.boolean(),
  firstCutPct: pct,
  obstacleOn: z.boolean(),
  obstaclePrice: money,
  obstacleMinutes: minutes,
  stairsOn: z.boolean(),
  stairsPrice: money,
  stairsMinutes: minutes,
});
export type ModifierFields = z.infer<typeof modifierFieldsSchema>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const toMin = (hours: number | undefined) => r2((hours ?? 0) * 60);
const toHours = (mins: number) => Math.round((mins / 60) * 10000) / 10000;
const toPct = (frac: number | undefined) => r2((frac ?? 0) * 100);
const toFrac = (p: number) => Math.round(p * 100) / 10000;

const isOn = (...values: (number | undefined)[]) => values.some((v) => (v ?? 0) !== 0);

/**
 * Saved modifiers are merged over the defaults, so a missing key would come back.
 * "Off" is therefore stored as zero amounts (or a 1x first cut), never as a missing key.
 */
export function modifiersToFields(raw: Modifiers): ModifierFields {
  const m = modifiersSchema.parse(raw);
  const s = m.slope ?? {};
  const slopePct = { gentle: toPct(s.gentle?.pricePct), moderate: toPct(s.moderate?.pricePct), steep: toPct(s.steep?.pricePct) };
  const slopeTimePct = { gentle: toPct(s.gentle?.hoursPct), moderate: toPct(s.moderate?.hoursPct), steep: toPct(s.steep?.hoursPct) };
  return {
    minimumPrice: m.minimum?.price ?? 0,
    minimumMinutes: toMin(m.minimum?.hours),
    slopeOn: isOn(...Object.values(slopePct), ...Object.values(slopeTimePct)),
    slopePct,
    slopeTimePct,
    gateOn: isOn(m.narrowGate?.extraPrice, m.narrowGate?.extraHours),
    gateInches: m.narrowGateInches,
    gatePrice: m.narrowGate?.extraPrice ?? 0,
    gateMinutes: toMin(m.narrowGate?.extraHours),
    firstCutOn: (m.firstCut?.multiplier ?? 1) !== 1,
    firstCutPct: r2(((m.firstCut?.multiplier ?? 1) - 1) * 100),
    obstacleOn: isOn(m.perObstacle?.extraPrice, m.perObstacle?.extraHours),
    obstaclePrice: m.perObstacle?.extraPrice ?? 0,
    obstacleMinutes: toMin(m.perObstacle?.extraHours),
    stairsOn: isOn(m.stairs?.extraPrice, m.stairs?.extraHours),
    stairsPrice: m.stairs?.extraPrice ?? 0,
    stairsMinutes: toMin(m.stairs?.extraHours),
  };
}

export function fieldsToModifiers(f: ModifierFields): Modifiers {
  const on = (flag: boolean, n: number) => (flag ? n : 0);
  const level = (p: number, t: number) => ({ pricePct: on(f.slopeOn, toFrac(p)), hoursPct: on(f.slopeOn, toFrac(t)) });
  return modifiersSchema.parse({
    narrowGateInches: f.gateInches,
    minimum: { price: f.minimumPrice, hours: toHours(f.minimumMinutes) },
    slope: {
      flat: { pricePct: 0, hoursPct: 0 },
      gentle: level(f.slopePct.gentle, f.slopeTimePct.gentle),
      moderate: level(f.slopePct.moderate, f.slopeTimePct.moderate),
      steep: level(f.slopePct.steep, f.slopeTimePct.steep),
    },
    narrowGate: { extraPrice: on(f.gateOn, f.gatePrice), extraHours: on(f.gateOn, toHours(f.gateMinutes)) },
    firstCut: { multiplier: f.firstCutOn ? 1 + f.firstCutPct / 100 : 1 },
    perObstacle: { extraPrice: on(f.obstacleOn, f.obstaclePrice), extraHours: on(f.obstacleOn, toHours(f.obstacleMinutes)) },
    stairs: { extraPrice: on(f.stairsOn, f.stairsPrice), extraHours: on(f.stairsOn, toHours(f.stairsMinutes)) },
  });
}

/** Worked examples, priced by the real engine, for a visit that normally costs `base`. */
export function modifierExamples(modifiers: Modifiers, base: number) {
  const rule: PricingRule = { type: "tier_matrix", quantityKey: "each", rows: [{ upTo: null, price: base, hours: 1, cost: 0 }] };
  const tiny: PricingRule = { type: "tier_matrix", quantityKey: "each", rows: [{ upTo: null, price: 10, hours: 0.1, cost: 0 }] };
  const at = (context: Parameters<typeof priceLine>[0]["context"], r = rule) => priceLine({ rule: r, quantities: {}, modifiers, context }).price;
  return {
    steep: at({ slope: "steep" }),
    narrowGate: at({ gateWidthIn: Math.max(1, modifiers.narrowGateInches - 12) }),
    firstCut: at({ firstCut: true }),
    obstacles: at({ obstacleCount: 3 }),
    stairs: at({ hasStairs: true }),
    small: at({}, tiny),
  };
}
