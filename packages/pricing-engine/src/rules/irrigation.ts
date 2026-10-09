import { line } from "../money";
import type { IrrigationRule, PricedLine, QuantityMap } from "../types";

export function priceIrrigation(rule: IrrigationRule, quantities: QuantityMap): PricedLine {
  const zones = quantities.zones ?? 0;
  const hours = (zones * rule.minutesPerZone) / 60;
  const price = zones * rule.pricePerZone;
  const cost = zones * rule.costPerZone;
  return {
    ...line(price, hours, cost),
    breakdown: [{ label: `${zones} zones`, ...line(price, hours, cost) }],
  };
}
