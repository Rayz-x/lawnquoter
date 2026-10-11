import { describe, expect, it } from "vitest";
import { priceLine } from "../price";
import { defaultModifiers, pricingRuleSchema } from "../types";
import { CATALOG_SEED_V1, CATALOG_VERSION, buildCatalogRule, mulchSqftPerYard } from "./seed";

const noMinimum = { ...defaultModifiers(), minimum: { price: 0, hours: 0 } };

describe("catalog seed v1", () => {
  it("has the 26 approved entries with unique keys", () => {
    expect(CATALOG_SEED_V1).toHaveLength(26);
    expect(new Set(CATALOG_SEED_V1.map((e) => e.key)).size).toBe(26);
    expect(CATALOG_VERSION).toBe("2026-10-11");
  });

  it("every rule template validates against the engine schema", () => {
    for (const entry of CATALOG_SEED_V1) {
      const rule = buildCatalogRule(entry, entry.starter.typical);
      expect(pricingRuleSchema.safeParse(rule).success, entry.key).toBe(true);
    }
  });

  it("one unit prices at the chosen starter price, inside the published range", () => {
    for (const entry of CATALOG_SEED_V1) {
      const { low, typical, high } = entry.starter;
      expect(typical).toBeGreaterThanOrEqual(low);
      expect(typical).toBeLessThanOrEqual(high);
      const rule = buildCatalogRule(entry, typical);
      const r = priceLine({ rule, quantities: entry.unitQuantities, modifiers: noMinimum, context: {} });
      // A program prices the whole season; its unit is one application.
      const unit = rule.type === "program" ? r.price / rule.applicationCount : r.price;
      expect(unit, entry.key).toBeGreaterThanOrEqual(low);
      expect(unit, entry.key).toBeLessThanOrEqual(high);
    }
  });

  it("uses the edited price when the owner changes it", () => {
    const aeration = CATALOG_SEED_V1.find((e) => e.key === "core-aeration")!;
    const rule = buildCatalogRule(aeration, 20);
    const r = priceLine({ rule, quantities: { turf_sqft: 9352 }, modifiers: noMinimum, context: {} });
    expect(r.price).toBe(200);
  });

  it("mulch converts bed area to cubic yards by depth", () => {
    expect(mulchSqftPerYard(2)).toBe(162);
    expect(mulchSqftPerYard(3)).toBe(108);
    const mulch = CATALOG_SEED_V1.find((e) => e.key === "mulch-installation")!;
    const rule = buildCatalogRule(mulch, 85.5);
    // 400 sq ft at 2 in = 2.47 yd, billed as 3 yd.
    const r = priceLine({ rule, quantities: { bed_sqft: 400 }, modifiers: noMinimum, context: {} });
    expect(r.price).toBe(256.5);
    const deep = buildCatalogRule(mulch, 85.5, { mulchDepthIn: 3 });
    expect(priceLine({ rule: deep, quantities: { bed_sqft: 400 }, modifiers: noMinimum, context: {} }).price).toBe(342);
  });

  it("weekly mowing keeps the existing tiers and biweekly is about 30% more", () => {
    const weekly = buildCatalogRule(CATALOG_SEED_V1.find((e) => e.key === "weekly-mowing")!, 55);
    const biweekly = buildCatalogRule(CATALOG_SEED_V1.find((e) => e.key === "biweekly-mowing")!, 72.5);
    const at = (rule: typeof weekly, turf: number) =>
      priceLine({ rule, quantities: { turf_sqft: turf }, modifiers: noMinimum, context: {} }).price;
    expect([at(weekly, 4000), at(weekly, 8000), at(weekly, 12000), at(weekly, 17000)]).toEqual([40, 55, 70, 80]);
    expect(at(biweekly, 8000)).toBe(71.5);
  });

  it("the company minimum still applies to small jobs", () => {
    const gutters = CATALOG_SEED_V1.find((e) => e.key === "gutter-cleaning")!;
    const r = priceLine({
      rule: buildCatalogRule(gutters, 1.5),
      quantities: { each: 10 },
      modifiers: defaultModifiers(),
      context: {},
    });
    expect(r.price).toBe(45);
  });

  it("fert program is 6 applications billed per application", () => {
    const rule = buildCatalogRule(CATALOG_SEED_V1.find((e) => e.key === "fert-weed-program")!, 95);
    expect(rule).toMatchObject({ type: "program", applicationCount: 6, billing: "per_app", perApp: { price: 95 } });
  });

  it("flags materials for CPA review and leaves every service untaxed by default", () => {
    const materials = CATALOG_SEED_V1.filter((e) => e.isMaterial).map((e) => e.key).sort();
    expect(materials).toEqual(["aeration-overseeding", "mulch-installation", "overseeding", "sod-installation"]);
    expect(CATALOG_SEED_V1.every((e) => e.taxable === false)).toBe(true);
  });

  it("snow entries are hidden unless the owner enables snow", () => {
    const snow = CATALOG_SEED_V1.filter((e) => e.category === "Snow");
    expect(snow.length).toBe(2);
    expect(snow.every((e) => e.kind === "snow")).toBe(true);
  });
});
