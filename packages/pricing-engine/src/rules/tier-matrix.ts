import { line } from "../money";
import { readQty } from "../quantities";
import type { PricedLine, QuantityMap, TierMatrixRule } from "../types";

/** Service Autopilot Rate Matrix: pick the matching band, then apply the tail. */
export function priceTierMatrix(rule: TierMatrixRule, quantities: QuantityMap): PricedLine {
  const qty = readQty(quantities, rule.quantityKey);
  const rows = [...rule.rows].sort((a, b) => {
    if (a.upTo == null) return 1;
    if (b.upTo == null) return -1;
    return a.upTo - b.upTo;
  });
  const row = rows.find((r) => r.upTo == null || qty <= r.upTo) ?? rows[rows.length - 1]!;
  let { price, hours, cost } = row;

  const breakdown = [{ label: `Tier up to ${row.upTo ?? "∞"}`, ...line(price, hours, cost) }];

  if (rule.tail && qty > rule.tail.over) {
    const steps = Math.ceil((qty - rule.tail.over) / rule.tail.every);
    const extra = line(steps * rule.tail.addPrice, steps * rule.tail.addHours, steps * rule.tail.addCost);
    price += extra.price;
    hours += extra.hours;
    cost += extra.cost;
    breakdown.push({
      label: `Every ${rule.tail.every} over ${rule.tail.over} × ${steps}`,
      ...extra,
    });
  }

  return { ...line(price, hours, cost), breakdown };
}
