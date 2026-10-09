import { line } from "../money";
import type { CatalogRule, PricedLine } from "../types";

/** Jobber-style catalog item: material and labor each get their own markup. */
export function priceCatalog(rule: CatalogRule): PricedLine {
  const material = rule.materialCost * (1 + rule.materialMarkupPct);
  const labor = rule.laborCost * (1 + rule.laborMarkupPct);
  return {
    ...line(material + labor, rule.laborHours, rule.materialCost + rule.laborCost),
    breakdown: [
      { label: "Material", ...line(material, 0, rule.materialCost) },
      { label: "Labor", ...line(labor, rule.laborHours, rule.laborCost) },
    ],
  };
}
