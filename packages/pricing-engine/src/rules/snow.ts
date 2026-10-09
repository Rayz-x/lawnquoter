import { line } from "../money";
import { priceTierMatrix } from "./tier-matrix";
import type { PricedLine, QuantityMap, SnowRule } from "../types";

export function priceSnow(rule: SnowRule, quantities: QuantityMap): PricedLine {
  if (rule.contract === "seasonal_flat" && rule.seasonal) {
    return {
      ...line(rule.seasonal.price, rule.seasonal.hours, rule.seasonal.cost),
      breakdown: [{ label: "Seasonal snow contract", ...line(rule.seasonal.price, rule.seasonal.hours, rule.seasonal.cost) }],
    };
  }
  if (rule.contract === "per_inch" && rule.inchTiers?.length) {
    return priceTierMatrix({ type: "tier_matrix", quantityKey: "inches", rows: rule.inchTiers }, quantities);
  }
  const push = rule.perPush ?? { price: 0, hours: 0, cost: 0 };
  const visits = quantities.visits ?? 1;
  return {
    ...line(push.price * visits, push.hours * visits, push.cost * visits),
    breakdown: [{ label: `Per push × ${visits}`, ...line(push.price * visits, push.hours * visits, push.cost * visits) }],
  };
}
