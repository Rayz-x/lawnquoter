import { describe, expect, it } from "vitest";
import { acceptanceTotals } from "./not-to-exceed";

const lines = [
  { id: "mow", price: 100, range_low: 90, range_high: 120 },
  { id: "bed", price: 50, range_low: null, range_high: null },
  { id: "extra", price: 25, range_low: 20, range_high: 40 },
  { id: "high-only", price: 10, range_low: null, range_high: 15 },
];

describe("acceptance totals", () => {
  it("caps ranged lines at range_high and keeps fixed lines at their price", () => {
    expect(acceptanceTotals(lines, ["mow", "bed", "extra"])).toEqual({
      acceptedTotal: 175,
      notToExceed: 210,
      hasRanges: true,
    });
  });

  it("ignores a range on a line the customer did not select", () => {
    expect(acceptanceTotals(lines, ["mow", "bed"])).toEqual({
      acceptedTotal: 150,
      notToExceed: 170,
      hasRanges: true,
    });
  });

  it("treats a quote with no complete range as a firm price", () => {
    expect(acceptanceTotals(lines, ["bed", "high-only"])).toEqual({
      acceptedTotal: 60,
      notToExceed: 60,
      hasRanges: false,
    });
  });
});
