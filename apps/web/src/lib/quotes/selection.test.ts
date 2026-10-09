import { describe, expect, it } from "vitest";
import { defaultSelectedIds, selectionFromIds, sumSelected } from "./selection";

const items = [
  { id: "mow", state: "included", option_group: null, selected: true, price: 50, hours: 1, cost: 20 },
  { id: "good", state: "optional", option_group: "Plan", selected: false, price: 10, hours: 0, cost: 4 },
  { id: "better", state: "optional", option_group: "Plan", selected: true, price: 20, hours: 0, cost: 8 },
  { id: "extra", state: "recommended", option_group: null, selected: false, price: 15, hours: 0.2, cost: 5 },
];

describe("proposal selection", () => {
  it("picks included lines and one option per group", () => {
    expect(defaultSelectedIds(items)).toEqual(["mow", "better"]);
    expect(sumSelected(items, defaultSelectedIds(items), "price")).toBe(70);
  });

  it("fills a missing option group instead of dropping it", () => {
    expect(selectionFromIds(items, ["mow"])).toEqual(["mow", "better"]);
  });
});
