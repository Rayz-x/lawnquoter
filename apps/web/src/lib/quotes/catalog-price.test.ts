import { mergeModifiers } from "@lawnquoter/pricing-engine";
import { describe, expect, it } from "vitest";
import { catalogPickerRules, measurementQuantities, priceCatalogLine } from "./catalog-price";

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
});
