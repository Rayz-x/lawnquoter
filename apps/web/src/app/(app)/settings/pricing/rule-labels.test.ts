import { QUANTITY_KEYS, defaultModifiers, pricingRuleSchema } from "@lawnquoter/pricing-engine";
import { describe, expect, it } from "vitest";
import { STARTER_TIERS, quantityLabel, ruleExample } from "./rule-labels";

describe("rule labels", () => {
  it("gives every measured quantity a plain label, never the code name", () => {
    for (const key of QUANTITY_KEYS) {
      const label = quantityLabel(key);
      expect(label.label).not.toContain("_");
      expect(label.unit).not.toContain("_");
    }
    expect(quantityLabel("bed_sqft")).toEqual({ label: "Bed area", unit: "sq ft" });
    expect(quantityLabel("mystery_key").label).toBe("Measured amount");
  });

  it("starter tiers are a valid engine rule", () => {
    expect(pricingRuleSchema.safeParse(STARTER_TIERS).success).toBe(true);
  });

  it("prices a worked example with the engine, including the minimum", () => {
    expect(ruleExample(STARTER_TIERS, defaultModifiers())).toEqual({ text: "a 10,000 sq ft lawn", price: 55 });
    const perShrub = { type: "tier_matrix" as const, quantityKey: "each", rows: [{ upTo: 1, price: 12.5, hours: 0, cost: 0 }], tail: { every: 1, over: 1, addPrice: 12.5, addHours: 0, addCost: 0 } };
    expect(ruleExample(perShrub, defaultModifiers())).toEqual({ text: "10 items", price: 125 });
  });

  it("gives a worked example for every non-tier rule type", () => {
    const m = { ...defaultModifiers(), minimum: { price: 0, hours: 0 } };
    expect(ruleExample({ type: "program", applicationCount: 6, perApp: { price: 95, hours: 0, cost: 0 }, prepayDiscountPct: 0, billing: "per_app" }, m)).toEqual({ text: "one property", price: 570 });
    expect(ruleExample({ type: "irrigation", pricePerZone: 10, minutesPerZone: 5, costPerZone: 0 }, m)).toEqual({ text: "an 8-zone system", price: 80 });
    expect(ruleExample({ type: "snow", contract: "per_push", perPush: { price: 50, hours: 0, cost: 0 }, triggerDepthIn: 2 }, m).price).toBe(50);
    expect(ruleExample({ type: "catalog", materialCost: 10, laborCost: 20, laborHours: 1, materialMarkupPct: 0.5, laborMarkupPct: 0.5 }, m).price).toBe(45);
  });
});
