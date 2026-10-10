import { describe, expect, it } from "vitest";
import { defaultSelectedIds } from "./selection";
import { quoteSectionTotals } from "./section-totals";

const sections = [
  { id: "sec-mow", title: "Mowing" },
  { id: "sec-beds", title: "Beds" },
];

describe("quote section totals", () => {
  it("sums each section into the grand total", () => {
    const items = [
      { id: "mow", state: "included", section_id: "sec-mow", option_group: null, selected: true, price: 50, hours: 1, cost: 20 },
      { id: "edge", state: "included", section_id: "sec-mow", option_group: null, selected: true, price: 15, hours: 0.25, cost: 5 },
      { id: "mulch", state: "included", section_id: "sec-beds", option_group: null, selected: true, price: 30, hours: 0.5, cost: 12 },
      { id: "extra", state: "optional", section_id: null, option_group: null, selected: true, price: 10, hours: 0.1, cost: 3 },
    ];
    const picked = defaultSelectedIds(items);
    const totals = quoteSectionTotals(items, sections, picked);

    expect(totals.sections).toEqual([
      { id: "sec-mow", title: "Mowing", price: 65, hours: 1.25, cost: 25 },
      { id: "sec-beds", title: "Beds", price: 30, hours: 0.5, cost: 12 },
    ]);
    expect(totals.addOns).toEqual({ price: 10, hours: 0.1, cost: 3 });
    expect(totals.total).toEqual({ price: 105, hours: 1.85, cost: 40 });
    expect(
      totals.sections.reduce((sum, section) => sum + section.price, 0) + totals.addOns.price,
    ).toBe(totals.total.price);
  });

  it("counts only one tier from an option group", () => {
    const items = [
      { id: "good", state: "optional", section_id: null, option_group: "Plan", option_tier: "good", selected: false, price: 100, hours: 2, cost: 40 },
      { id: "better", state: "optional", section_id: null, option_group: "Plan", option_tier: "better", selected: true, price: 160, hours: 3, cost: 60 },
      { id: "best", state: "optional", section_id: null, option_group: "Plan", option_tier: "best", selected: false, price: 220, hours: 4, cost: 80 },
    ];
    const picked = defaultSelectedIds(items);
    const totals = quoteSectionTotals(items, sections, picked);

    expect(picked).toEqual(["better"]);
    expect(totals.total.price).toBe(160);
    expect(totals.total.hours).toBe(3);
    expect(totals.total.cost).toBe(60);
    // Never the sum of every tier.
    expect(totals.total.price).not.toBe(480);
  });

  it("keeps pick-one when the option group lives inside a section", () => {
    const items = [
      { id: "base", state: "included", section_id: "sec-mow", option_group: null, selected: true, price: 40, hours: 0.5, cost: 15 },
      { id: "good", state: "optional", section_id: "sec-mow", option_group: "Season plan", option_tier: "good", selected: false, price: 100, hours: 2, cost: 40 },
      { id: "better", state: "optional", section_id: "sec-mow", option_group: "Season plan", option_tier: "better", selected: true, price: 150, hours: 3, cost: 55 },
      { id: "trim", state: "included", section_id: "sec-beds", option_group: null, selected: true, price: 25, hours: 0.4, cost: 8 },
    ];
    const picked = defaultSelectedIds(items);
    const totals = quoteSectionTotals(items, sections, picked);

    expect(picked).toEqual(["base", "trim", "better"]);
    expect(totals.sections.find((section) => section.id === "sec-mow")).toEqual({
      id: "sec-mow",
      title: "Mowing",
      price: 190,
      hours: 3.5,
      cost: 70,
    });
    expect(totals.sections.find((section) => section.id === "sec-beds")).toEqual({
      id: "sec-beds",
      title: "Beds",
      price: 25,
      hours: 0.4,
      cost: 8,
    });
    expect(totals.total.price).toBe(215);
    expect(totals.sections.reduce((sum, section) => sum + section.price, 0)).toBe(totals.total.price);
  });
});
