import { line } from "../money";
import { priceTierMatrix } from "./tier-matrix";
import type { PricedLine, QuantityMap, SnowRule } from "../types";

function belowTrigger(): PricedLine {
  return { ...line(0, 0, 0), breakdown: [{ label: "Below trigger depth", ...line(0, 0, 0) }] };
}

export function priceSnow(rule: SnowRule, quantities: QuantityMap): PricedLine {
  const trigger = rule.triggerDepthIn ?? 0;
  const depthKnown = quantities.inches != null;
  if (depthKnown && (quantities.inches ?? 0) < trigger && rule.contract !== "seasonal_flat") {
    return belowTrigger();
  }

  if (rule.contract === "seasonal_flat") {
    if (!rule.seasonal) throw new Error("seasonal snow rule is missing a seasonal price");
    return {
      ...line(rule.seasonal.price, rule.seasonal.hours, rule.seasonal.cost),
      breakdown: [{ label: "Seasonal snow contract", ...line(rule.seasonal.price, rule.seasonal.hours, rule.seasonal.cost) }],
    };
  }
  if (rule.contract === "per_inch") {
    if (!rule.inchTiers?.length) throw new Error("per-inch snow rule is missing inch tiers");
    return priceTierMatrix({ type: "tier_matrix", quantityKey: "inches", rows: rule.inchTiers }, quantities);
  }
  if (!rule.perPush) throw new Error("per-push snow rule is missing a per-push price");
  const visits = quantities.visits ?? 1;
  return {
    ...line(rule.perPush.price * visits, rule.perPush.hours * visits, rule.perPush.cost * visits),
    breakdown: [{ label: `Per push × ${visits}`, ...line(rule.perPush.price * visits, rule.perPush.hours * visits, rule.perPush.cost * visits) }],
  };
}
