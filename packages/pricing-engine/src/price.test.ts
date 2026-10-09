import { describe, expect, it } from "vitest";
import { priceLine } from "./price";
import { parseMaterialsCsv, scaleRule } from "./updates";
import { defaultModifiers, type AssemblyRule, type CatalogRule, type IrrigationRule, type ProgramRule, type SnowRule, type TierMatrixRule } from "./types";

const mow: TierMatrixRule = {
  type: "tier_matrix",
  quantityKey: "turf_sqft",
  rows: [
    { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
    { upTo: 10000, price: 55, hours: 0.75, cost: 24 },
    { upTo: null, price: 70, hours: 1, cost: 32 },
  ],
  tail: { every: 1000, over: 15000, addPrice: 5, addHours: 0.08, addCost: 2 },
};

const modifiers = {
  ...defaultModifiers(),
  minimum: { price: 0, hours: 0 },
  travel: undefined,
  routeDensityDiscount: undefined,
};

describe("tier matrix", () => {
  it("picks the matching band", () => {
    const r = priceLine({ rule: mow, quantities: { turf_sqft: 8000 }, modifiers, context: {} });
    expect(r.price).toBe(55);
    expect(r.hours).toBe(0.75);
    expect(r.cost).toBe(24);
  });

  it("uses a combined turf total when only one side was traced", () => {
    const partial = priceLine({
      rule: mow,
      quantities: { turf_front_sqft: 3000, turf_sqft: 8000 },
      modifiers,
      context: {},
    });
    expect(partial.price).toBe(55);

    const split = priceLine({
      rule: mow,
      quantities: { turf_front_sqft: 3000, turf_back_sqft: 3000 },
      modifiers,
      context: {},
    });
    expect(split.price).toBe(55);
  });

  it("applies the every-N-over-X tail", () => {
    const r = priceLine({ rule: mow, quantities: { turf_sqft: 17000 }, modifiers, context: {} });
    // base 70 + 2 steps of 5
    expect(r.price).toBe(80);
    expect(r.hours).toBe(1.16);
  });
});

describe("assembly", () => {
  const install: AssemblyRule = {
    type: "assembly",
    quantityKey: "each",
    items: [
      { kind: "labor", name: "Crew", hourlyRate: 40, hoursPerUnit: 0.5 },
      { kind: "equipment", name: "Skid", hourlyRate: 25, hoursPerUnit: 0.25 },
      { kind: "material", name: "Mulch", unitCost: 30, qtyPerUnit: 2, wastePct: 0.1 },
    ],
    overheadPct: 0.15,
    targetMarginPct: 0.4,
  };

  it("recovers overhead and target margin", () => {
    const r = priceLine({ rule: install, quantities: { each: 2 }, modifiers, context: {} });
    // labor hours 1, equip hours 0.5, labor cost 40, equip 12.5, material 2*2*1.1*30 = 132
    // cost = 184.5, with overhead 212.175, / 0.6 = 353.625 → 353.63
    expect(r.cost).toBe(184.5);
    expect(r.hours).toBe(1.5);
    expect(r.price).toBe(353.63);
    expect(r.breakdown.reduce((sum, row) => sum + row.price, 0)).toBe(353.63);
  });

  it("applies complexity to labor and equipment, not materials", () => {
    const r = priceLine({ rule: install, quantities: { each: 2 }, modifiers, context: { complexity: 2 } });
    // labor 2h * 40 = 80, equipment 1h * 25 = 25, material stays 132
    expect(r.hours).toBe(3);
    expect(r.cost).toBe(237);
  });
});

describe("catalog", () => {
  it("marks up material and labor separately", () => {
    const rule: CatalogRule = {
      type: "catalog",
      materialCost: 100,
      laborCost: 50,
      laborHours: 1,
      materialMarkupPct: 0.3,
      laborMarkupPct: 0.5,
    };
    const r = priceLine({ rule, quantities: {}, modifiers, context: {} });
    expect(r.price).toBe(205);
    expect(r.cost).toBe(150);
    expect(r.hours).toBe(1);
  });
});

describe("program", () => {
  const fert: ProgramRule = {
    type: "program",
    applicationCount: 6,
    perApp: { price: 60, hours: 0.4, cost: 18 },
    prepayDiscountPct: 0.1,
    billing: "per_app",
  };

  it("prices per application", () => {
    const r = priceLine({ rule: fert, quantities: {}, modifiers, context: {} });
    expect(r.price).toBe(360);
    expect(r.hours).toBe(2.4);
  });

  it("applies prepay discount", () => {
    const r = priceLine({ rule: { ...fert, billing: "prepay" }, quantities: {}, modifiers, context: {} });
    expect(r.price).toBe(324);
  });
});

describe("snow and irrigation", () => {
  it("prices per-inch snow tiers", () => {
    const rule: SnowRule = {
      type: "snow",
      contract: "per_inch",
      triggerDepthIn: 1,
      inchTiers: [
        { upTo: 2, price: 45, hours: 0.6, cost: 16 },
        { upTo: 6, price: 75, hours: 1.1, cost: 28 },
        { upTo: null, price: 120, hours: 2, cost: 48 },
      ],
    };
    expect(priceLine({ rule, quantities: { inches: 3 }, modifiers, context: {} }).price).toBe(75);
    expect(priceLine({ rule, quantities: { inches: 0.5 }, modifiers, context: {} }).price).toBe(0);
    expect(() => priceLine({ rule: { ...rule, inchTiers: [] }, quantities: { inches: 3 }, modifiers, context: {} })).toThrow(
      /inch tiers/,
    );
  });

  it("prices irrigation by zone and sets duration", () => {
    const rule: IrrigationRule = { type: "irrigation", pricePerZone: 12, minutesPerZone: 8, costPerZone: 4 };
    const r = priceLine({ rule, quantities: { zones: 6 }, modifiers, context: {} });
    expect(r.price).toBe(72);
    expect(r.hours).toBe(0.8);
  });
});

describe("modifiers and confidence", () => {
  it("adds slope, narrow gate, first-cut, and a minimum", () => {
    const r = priceLine({
      rule: mow,
      quantities: { turf_sqft: 4000 },
      modifiers: defaultModifiers(),
      context: { slope: "steep", gateWidthIn: 36, firstCut: true, obstacleCount: 2 },
    });
    expect(r.price).toBeGreaterThan(40);
    expect(r.hours).toBeGreaterThan(0.5);
    expect(r.breakdown.some((b) => b.label.startsWith("Slope"))).toBe(true);
    expect(r.breakdown.some((b) => b.label.startsWith("Narrow gate"))).toBe(true);
    expect(r.breakdown.some((b) => b.label.startsWith("First cut"))).toBe(true);
    const slope = r.breakdown.find((b) => b.label.startsWith("Slope"));
    // Steep slope cost follows extra hours (hoursPct 0.4), same as bagging, not the 0.25 price percent.
    expect(slope?.cost).toBeCloseTo(18 * 0.4, 2);
  });

  it("returns a range when confidence is low", () => {
    const r = priceLine({
      rule: mow,
      quantities: { turf_sqft: 4000 },
      modifiers,
      context: { confidence: 0.4 },
    });
    expect(r.range).toBeDefined();
    expect(r.range!.low).toBeLessThan(r.price);
    expect(r.range!.high).toBeGreaterThan(r.price);
  });

  it("returns a point price when confidence is high", () => {
    const r = priceLine({
      rule: mow,
      quantities: { turf_sqft: 4000 },
      modifiers,
      context: { confidence: 0.9 },
    });
    expect(r.range).toBeUndefined();
  });
});

describe("mass update and csv", () => {
  it("scales tier prices", () => {
    const next = scaleRule(mow, 1.1);
    if (next.type !== "tier_matrix") throw new Error("expected tier");
    expect(next.rows[0]?.price).toBe(44);
  });

  it("scales assembly rates", () => {
    const install: AssemblyRule = {
      type: "assembly",
      quantityKey: "each",
      items: [
        { kind: "labor", name: "Crew", hourlyRate: 40, hoursPerUnit: 1 },
        { kind: "material", name: "Mulch", unitCost: 10, qtyPerUnit: 1, wastePct: 0 },
      ],
      overheadPct: 0,
      targetMarginPct: 0,
    };
    const next = scaleRule(install, 1.1);
    if (next.type !== "assembly") throw new Error("expected assembly");
    const labor = next.items.find((item) => item.kind === "labor");
    const material = next.items.find((item) => item.kind === "material");
    if (labor?.kind !== "labor" || material?.kind !== "material") throw new Error("expected items");
    expect(labor.hourlyRate).toBe(44);
    expect(material.unitCost).toBe(11);
  });

  it("parses a materials csv", () => {
    const rows = parseMaterialsCsv("sku,name,unit,unit_cost\nA1,Mulch,yd,42.50\nB2,Seed,lb,$3.10\n");
    expect(rows).toEqual([
      { sku: "A1", name: "Mulch", unit: "yd", unitCost: 42.5 },
      { sku: "B2", name: "Seed", unit: "lb", unitCost: 3.1 },
    ]);
  });
});
