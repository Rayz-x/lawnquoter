import { mergeModifiers } from "@lawnquoter/pricing-engine";
import { describe, expect, it } from "vitest";
import { catalogPickerRules, priceCatalogLine } from "./catalog-price";

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
