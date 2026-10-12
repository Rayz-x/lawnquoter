import { defaultModifiers, mergeModifiers } from "@lawnquoter/pricing-engine";
import { describe, expect, it } from "vitest";
import { catalogPickerRules, measurementQuantities, monthInTimeZone, priceCatalogLine, serviceMinimumPrice } from "./catalog-price";

describe("measurementQuantities", () => {
  it("maps measured areas to pricing quantity keys", () => {
    expect(measurementQuantities([{ category: "turf_front", area_sqft: 3200 }, { category: "turf_back", area_sqft: 2800 }, { category: "edging_line", length_ft: 120 }], 15000)).toEqual({ turf_front_sqft: 3200, turf_back_sqft: 2800, edging_lf: 120, lot_sqft: 15000 });
  });
});

describe("catalogPickerRules", () => {
  it("drops a rule whose price list is missing or inactive", () => {
    const rules = [
      { id: "keep", price_list_id: "list-1" },
      { id: "gone", price_list_id: "missing" },
      { id: "old", price_list_id: "archived" },
    ];
    const lists = [
      { id: "list-1", status: "active" },
      { id: "archived", status: "archived" },
    ];
    expect(catalogPickerRules(rules, lists).map((rule) => rule.id)).toEqual(["keep"]);
  });
});

describe("priceCatalogLine", () => {
  it("rejects a rule the catalog cannot price", () => {
    const priced = priceCatalogLine({
      config: { type: "tier_matrix" },
      modifiers: mergeModifiers(null),
      features: [],
      property: null,
    });
    expect(priced).toEqual({ ok: false, error: "Pricing rule is not valid" });
  });

  it("adds the farther trip charge from the property drive time", () => {
    const priced = priceCatalogLine({
      config: { type: "catalog", materialCost: 0, laborCost: 20, laborHours: 1, materialMarkupPct: 0, laborMarkupPct: 0 },
      modifiers: { ...defaultModifiers(), minimum: { price: 0, hours: 0 }, travelZones: [{ label: "Farther", maxMinutes: null, maxMiles: null, extraPrice: 15 }] },
      features: [],
      property: { driveMinutes: 40 },
    });
    expect(priced).toMatchObject({ ok: true, priced: { price: 35 } });
  });
});

describe("pricing context helpers", () => {
  it("reads the month in the company timezone and a joined service minimum", () => {
    expect(monthInTimeZone(new Date("2026-07-15T04:00:00.000Z"), "America/Chicago")).toBe(7);
    expect(serviceMinimumPrice({ services: { minimum_price: "80" } })).toBe(80);
    expect(serviceMinimumPrice({ services: null })).toBeUndefined();
  });
});
