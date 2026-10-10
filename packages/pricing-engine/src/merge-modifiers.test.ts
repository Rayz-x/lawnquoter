import { describe, expect, it } from "vitest";
import { priceLine } from "./price";
import { defaultModifiers, mergeModifiers, type CatalogRule } from "./types";

const small: CatalogRule = {
  type: "catalog",
  materialCost: 10,
  laborCost: 0,
  laborHours: 1,
  materialMarkupPct: 0,
  laborMarkupPct: 0,
};

const lot = { slope: "gentle" as const, gateWidthIn: 36 };

describe("mergeModifiers", () => {
  it("applies slope, gate, and minimum when a price list stores {}", () => {
    const merged = mergeModifiers({});
    expect(merged.slope?.steep).toEqual({ pricePct: 0.25, hoursPct: 0.4 });
    expect(merged.narrowGate).toEqual({ extraHours: 0.15, extraPrice: 8 });
    expect(merged.minimum).toEqual({ price: 45, hours: 0.4 });

    const skipped = priceLine({ rule: small, quantities: {}, modifiers: {} as typeof merged, context: lot });
    expect(skipped.breakdown.map((row) => row.label)).toEqual(["Material", "Labor"]);

    const priced = priceLine({ rule: small, quantities: {}, modifiers: merged, context: lot });
    expect(priced.breakdown.map((row) => row.label)).toEqual([
      "Material",
      "Labor",
      "Slope (gentle)",
      "Narrow gate (36 in)",
      "Service minimum",
    ]);
    expect(priced.price).toBe(45);
  });

  it("does not charge a narrow gate for no gate or non-positive widths", () => {
    const merged = mergeModifiers({});
    for (const gateWidthIn of [0, -4]) {
      const priced = priceLine({ rule: small, quantities: {}, modifiers: merged, context: { gateWidthIn } });
      expect(priced.breakdown.some((row) => row.label.startsWith("Narrow gate"))).toBe(false);
    }
  });

  it("keeps a stored override and fills every omitted key", () => {
    const merged = mergeModifiers({ minimum: { price: 80 } });
    expect(merged.minimum).toEqual({ price: 80 });
    expect(merged.slope?.moderate).toEqual(defaultModifiers().slope?.moderate);
    expect(merged.narrowGateInches).toBe(48);
  });

  it("uses defaults for null and drops dead bagging, travel, and route keys", () => {
    expect(mergeModifiers(null)).toEqual(defaultModifiers());
    expect(mergeModifiers(undefined)).toEqual(defaultModifiers());
    const merged = mergeModifiers({
      bagging: { pricePct: 0.2, hoursPct: 0.35 },
      travel: { hourlyRate: 45, freeMinutes: 10 },
      routeDensityDiscount: { minNearby: 4, pricePct: -0.05 },
    });
    expect(merged).toEqual(defaultModifiers());
    expect(merged).not.toHaveProperty("bagging");
    expect(merged).not.toHaveProperty("travel");
    expect(merged).not.toHaveProperty("routeDensityDiscount");
  });
});
