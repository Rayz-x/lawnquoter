import { mergeModifiers } from "@lawnquoter/pricing-engine";
import { describe, expect, it } from "vitest";
import { measurementQuantities, priceCatalogLine } from "./catalog-price";

const mow = {
  type: "tier_matrix",
  quantityKey: "turf_sqft",
  rows: [
    { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
    { upTo: 10000, price: 55, hours: 0.75, cost: 24 },
    { upTo: null, price: 70, hours: 1, cost: 32 },
  ],
};

describe("measurementQuantities", () => {
  it("sums traced areas and keeps the lot size", () => {
    expect(measurementQuantities([
      { category: "turf_front", area_sqft: 3000 },
      { category: "turf_front", area_sqft: 500 },
      { category: "turf_back", area_sqft: 4500 },
      { category: "edging_line", length_ft: 40 },
      { category: "bed", area_sqft: 0 },
    ], 9000)).toEqual({ turf_front_sqft: 3500, turf_back_sqft: 4500, edging_lf: 40, lot_sqft: 9000 });
  });
});

describe("priceCatalogLine", () => {
  const features = [{ category: "turf_front", area_sqft: 8000 }];

  it("raises the catalog price for a steep lot", () => {
    const flat = priceCatalogLine({
      config: mow,
      modifiers: mergeModifiers({}),
      features,
      property: { slope: "flat", lotSqft: 12000 },
    });
    const steep = priceCatalogLine({
      config: mow,
      modifiers: mergeModifiers({}),
      features,
      property: { slope: "steep", lotSqft: 12000 },
    });
    expect(flat.ok && flat.priced.price).toBe(55);
    expect(steep.ok && steep.priced.price).toBe(68.75);
    expect(steep.ok && steep.priced.hours).toBe(1.05);
    expect(steep.ok && steep.priced.cost).toBe(33.6);
  });

  it("rejects a rule the catalog cannot price", () => {
    const priced = priceCatalogLine({
      config: { type: "tier_matrix" },
      modifiers: mergeModifiers(null),
      features: [],
      property: null,
    });
    expect(priced).toEqual({ ok: false, error: "Pricing rule is not valid" });
  });
});
