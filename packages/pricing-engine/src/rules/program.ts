import { line } from "../money";
import type { PricedLine, ProgramRule } from "../types";

/** Multi-application fert/weed plan: per-visit or prepaid with a count discount. */
export function priceProgram(rule: ProgramRule): PricedLine {
  const n = rule.applicationCount;
  const base = {
    price: rule.perApp.price * n,
    hours: rule.perApp.hours * n,
    cost: rule.perApp.cost * n,
  };
  if (rule.billing === "prepay" && rule.prepayDiscountPct > 0) {
    const discounted = base.price * (1 - rule.prepayDiscountPct);
    return {
      ...line(discounted, base.hours, base.cost),
      breakdown: [
        { label: `${n} applications`, ...line(base.price, base.hours, base.cost) },
        { label: `Prepay ${Math.round(rule.prepayDiscountPct * 100)}% off`, ...line(discounted - base.price, 0, 0) },
      ],
    };
  }
  return {
    ...line(base.price, base.hours, base.cost),
    breakdown: [{ label: `${n} applications @ ${rule.perApp.price}`, ...line(base.price, base.hours, base.cost) }],
  };
}
