import type { PricingRule } from "./types";
import { roundMoney } from "./money";

/** Mass-update: scale every dollar figure on a rule. Hours stay put. */
export function scaleRule(rule: PricingRule, factor: number): PricingRule {
  if (rule.type === "tier_matrix") {
    return {
      ...rule,
      rows: rule.rows.map((r) => ({ ...r, price: roundMoney(r.price * factor), cost: roundMoney(r.cost * factor) })),
      tail: rule.tail
        ? { ...rule.tail, addPrice: roundMoney(rule.tail.addPrice * factor), addCost: roundMoney(rule.tail.addCost * factor) }
        : undefined,
    };
  }
  if (rule.type === "catalog") {
    return {
      ...rule,
      materialCost: roundMoney(rule.materialCost * factor),
      laborCost: roundMoney(rule.laborCost * factor),
    };
  }
  if (rule.type === "program") {
    return {
      ...rule,
      perApp: {
        ...rule.perApp,
        price: roundMoney(rule.perApp.price * factor),
        cost: roundMoney(rule.perApp.cost * factor),
      },
    };
  }
  if (rule.type === "snow") {
    return {
      ...rule,
      perPush: rule.perPush
        ? { ...rule.perPush, price: roundMoney(rule.perPush.price * factor), cost: roundMoney(rule.perPush.cost * factor) }
        : undefined,
      seasonal: rule.seasonal
        ? { ...rule.seasonal, price: roundMoney(rule.seasonal.price * factor), cost: roundMoney(rule.seasonal.cost * factor) }
        : undefined,
      inchTiers: rule.inchTiers?.map((r) => ({ ...r, price: roundMoney(r.price * factor), cost: roundMoney(r.cost * factor) })),
    };
  }
  if (rule.type === "irrigation") {
    return { ...rule, pricePerZone: roundMoney(rule.pricePerZone * factor), costPerZone: roundMoney(rule.costPerZone * factor) };
  }
  return {
    ...rule,
    items: rule.items.map((item) =>
      item.kind === "material"
        ? { ...item, unitCost: roundMoney(item.unitCost * factor) }
        : { ...item, hourlyRate: roundMoney(item.hourlyRate * factor) },
    ),
  };
}

export type MaterialCsvRow = { sku: string; name: string; unit: string; unitCost: number };

/** Parse a SiteOne/Home Depot-style materials CSV (sku,name,unit,unit_cost). */
export function parseMaterialsCsv(csv: string): MaterialCsvRow[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = splitCsv(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const skuI = header.findIndex((h) => h === "sku" || h === "item" || h === "part");
  const nameI = header.findIndex((h) => h === "name" || h === "description" || h === "product");
  const unitI = header.findIndex((h) => h === "unit" || h === "uom");
  const costI = header.findIndex((h) => h === "unit_cost" || h === "cost" || h === "price");
  if (nameI < 0 || costI < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const cols = splitCsv(line);
    const unitCost = Number(cols[costI]?.replace(/[$,]/g, ""));
    if (!Number.isFinite(unitCost)) return [];
    return [
      {
        sku: skuI >= 0 ? (cols[skuI] ?? "") : "",
        name: cols[nameI] ?? "",
        unit: unitI >= 0 ? (cols[unitI] ?? "each") : "each",
        unitCost,
      },
    ];
  });
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
