import { GATE_CHIP_UNDER_IN, mergeModifiers, priceLine, pricingRuleSchema, roundMoney } from "@lawnquoter/pricing-engine";
import {
  INSTANT_QUOTE_CONFIRM,
  instantQuoteStep,
  type InstantQuoteDraft,
  type InstantQuoteOffer,
} from "./instant-quote";

export type CatalogRuleInput = { name: string; config: unknown };

/** Price the selected service from the company catalog. Confidence sets the low/high band. */
export function instantQuoteFromCatalog(input: {
  draft: InstantQuoteDraft;
  serviceAreaZips: string[];
  statedMinimum: number;
  rules: readonly CatalogRuleInput[];
  modifiers: unknown;
  confidence: number | null;
}): InstantQuoteOffer | null {
  const { draft } = input;
  if (instantQuoteStep(draft, input.serviceAreaZips) !== "confirm") return null;
  const lot = draft.lotSqft;
  if (lot == null || !Number.isFinite(lot) || lot <= 0) return null;
  if (!Number.isFinite(input.statedMinimum) || input.statedMinimum < 0) return null;

  const service = draft.service.trim().toLowerCase();
  const modifiers = mergeModifiers(input.modifiers);
  let low = 0;
  let high = 0;
  let priced = false;

  for (const rule of input.rules) {
    if (rule.name.trim().toLowerCase() !== service) continue;
    const parsed = pricingRuleSchema.safeParse(rule.config);
    if (!parsed.success) continue;
    const line = priceLine({
      rule: parsed.data,
      quantities: { turf_sqft: lot, lot_sqft: lot },
      modifiers,
      context: {
        confidence: input.confidence ?? undefined,
        gateWidthIn: draft.hasGate ? GATE_CHIP_UNDER_IN : null,
      },
    });
    low += line.range?.low ?? line.price;
    high += line.range?.high ?? line.price;
    priced = true;
  }

  if (!priced) return null;
  const minimum = roundMoney(input.statedMinimum);
  let shownLow = roundMoney(low);
  let shownHigh = roundMoney(high);
  if (shownLow < minimum) shownLow = minimum;
  if (shownHigh < shownLow) shownHigh = shownLow;
  return { low: shownLow, high: shownHigh, statedMinimum: minimum, confirm: INSTANT_QUOTE_CONFIRM };
}
