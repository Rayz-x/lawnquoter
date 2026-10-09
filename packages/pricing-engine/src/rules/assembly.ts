import { line, roundHours, roundMoney } from "../money";
import { readQty } from "../quantities";
import type { AssemblyRule, PricedLine, QuantityMap } from "../types";

/** LMN/Aspire cost-up: labor + equipment + materials, then overhead and target margin. */
export function priceAssembly(rule: AssemblyRule, quantities: QuantityMap, complexity = 1): PricedLine {
  const qty = readQty(quantities, rule.quantityKey);
  const factor = complexity > 0 ? complexity : 1;
  let hours = 0;
  let cost = 0;
  const breakdown: PricedLine["breakdown"] = [];

  for (const item of rule.items) {
    if (item.kind === "material") {
      const units = qty * item.qtyPerUnit * (1 + (item.wastePct ?? 0));
      const itemCost = units * item.unitCost;
      cost += itemCost;
      breakdown.push({ label: item.name, price: 0, hours: 0, cost: roundMoney(itemCost) });
    } else {
      const itemHours = qty * item.hoursPerUnit * factor;
      const itemCost = itemHours * item.hourlyRate;
      hours += itemHours;
      cost += itemCost;
      breakdown.push({ label: item.name, price: 0, hours: roundHours(itemHours), cost: roundMoney(itemCost) });
    }
  }

  const withOverhead = cost * (1 + rule.overheadPct);
  const margin = Math.min(0.95, Math.max(0, rule.targetMarginPct));
  const price = margin >= 1 ? withOverhead : withOverhead / (1 - margin);
  const priced = line(price, hours, cost);
  breakdown.push({ label: "Sell price", price: priced.price, hours: 0, cost: 0 });
  return { ...priced, breakdown };
}
