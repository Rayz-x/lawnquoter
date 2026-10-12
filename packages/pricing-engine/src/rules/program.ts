import { line } from "../money";
import type { PricedLine, ProgramRule } from "../types";

/** The highest application-count tier the program meets replaces the flat prepay percent. */
function prepayDiscount(rule: ProgramRule): { pct: number; fromTier: boolean } {
  const matched = [...(rule.prepayTiers ?? [])]
    .filter((tier) => rule.applicationCount >= tier.minApps)
    .sort((a, b) => a.minApps - b.minApps)
    .at(-1);
  return matched ? { pct: matched.discountPct, fromTier: true } : { pct: rule.prepayDiscountPct, fromTier: false };
}

/** Multi-application fert/weed plan: per-visit or prepaid with a count discount. */
export function priceProgram(rule: ProgramRule): PricedLine {
  const n = rule.applicationCount;
  const base = {
    price: rule.perApp.price * n,
    hours: rule.perApp.hours * n,
    cost: rule.perApp.cost * n,
  };
  const discount = prepayDiscount(rule);
  if (rule.billing === "prepay" && discount.pct > 0) {
    const discounted = base.price * (1 - discount.pct);
    const label = discount.fromTier
      ? `Prepay ${Math.round(discount.pct * 100)}% off for ${n} applications`
      : `Prepay ${Math.round(discount.pct * 100)}% off`;
    return {
      ...line(discounted, base.hours, base.cost),
      breakdown: [
        { label: `${n} applications`, ...line(base.price, base.hours, base.cost) },
        { label, ...line(discounted - base.price, 0, 0) },
      ],
    };
  }
  return {
    ...line(base.price, base.hours, base.cost),
    breakdown: [{ label: `${n} applications @ ${rule.perApp.price}`, ...line(base.price, base.hours, base.cost) }],
  };
}
