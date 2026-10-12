import { describe, expect, it } from "vitest";
import { annualCents, bulkMeasuredSqft, packageAnnualCents } from "./package";

describe("bid packages", () => {
  it("prices a weekly line for a year and a one-time line once", () => {
    expect(annualCents({ unitPrice: 0.01, qty: 1000, frequency: "weekly" })).toBe(52000);
    expect(packageAnnualCents([{ unitPrice: 400, qty: 1, frequency: "once" }])).toBe(40000);
  });

  it("applies one bulk measurement, or each lot when no override is given", () => {
    expect(
      bulkMeasuredSqft(
        [
          { id: "a", lotSqft: 1000 },
          { id: "b", lotSqft: null },
        ],
        5000,
      ),
    ).toEqual([
      { id: "a", measuredSqft: 5000 },
      { id: "b", measuredSqft: 5000 },
    ]);
    expect(bulkMeasuredSqft([{ id: "a", lotSqft: 1000 }], null)).toEqual([{ id: "a", measuredSqft: 1000 }]);
  });
});
