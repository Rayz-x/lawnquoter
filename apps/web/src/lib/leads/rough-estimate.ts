import {
  priceLine,
  pricingRuleSchema,
  type Modifiers,
  type QuantityMap,
} from "@lawnquoter/pricing-engine";
import { hasRole, type OrgRole } from "@lawnquoter/shared";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";

/** Always shown with an office-visible rough estimate. Never customer-facing. */
export const ROUGH_ESTIMATE_LABEL = "rough, not measured" as const;

export type RoughEstimateRule = {
  config: unknown;
  modifiers: Modifiers;
};

export type RoughEstimateResult =
  | { kind: "hidden" }
  | { kind: "none" }
  | { kind: "estimate"; amount: number; label: typeof ROUGH_ESTIMATE_LABEL };

function parseLotSqft(lotSqft: number | string | null | undefined): number | null {
  if (lotSqft == null || lotSqft === "") return null;
  const n = typeof lotSqft === "number" ? lotSqft : Number(lotSqft);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Lot-only quantities for a rough internal price. Turf rules get lot as a proxy. */
export function roughLotQuantities(lotSqft: number): QuantityMap {
  return {
    lot_sqft: lotSqft,
    turf_sqft: lotSqft,
  };
}

/**
 * Office-only rough estimate from lot size + catalog rules via the pricing engine.
 * Missing lot size → no estimate (not $0). Non-office roles → hidden.
 */
export function roughEstimateForOffice(input: {
  lotSqft: number | string | null | undefined;
  rules: readonly RoughEstimateRule[];
  orgRole: OrgRole | null | undefined;
}): RoughEstimateResult {
  if (!hasRole(input.orgRole, OFFICE_ROLES)) return { kind: "hidden" };

  const lot = parseLotSqft(input.lotSqft);
  if (lot == null) return { kind: "none" };

  const quantities = roughLotQuantities(lot);
  let total = 0;
  let pricedAny = false;

  for (const rule of input.rules) {
    const parsed = pricingRuleSchema.safeParse(rule.config);
    if (!parsed.success) continue;
    const priced = priceLine({
      rule: parsed.data,
      quantities,
      modifiers: rule.modifiers,
      context: {},
    });
    if (!Number.isFinite(priced.price)) continue;
    total += priced.price;
    pricedAny = true;
  }

  if (!pricedAny) return { kind: "none" };

  return {
    kind: "estimate",
    amount: Math.round(total * 100) / 100,
    label: ROUGH_ESTIMATE_LABEL,
  };
}
