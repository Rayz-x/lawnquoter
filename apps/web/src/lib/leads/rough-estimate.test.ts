import { defaultModifiers, mergeModifiers, type TierMatrixRule } from "@lawnquoter/pricing-engine";
import { describe, expect, it } from "vitest";
import { ROUGH_ESTIMATE_LABEL, roughEstimateForOffice } from "./rough-estimate";

const lotMow: TierMatrixRule = {
  type: "tier_matrix",
  quantityKey: "lot_sqft",
  rows: [
    { upTo: 10000, price: 40, hours: 0.5, cost: 18 },
    { upTo: 20000, price: 55, hours: 0.75, cost: 24 },
    { upTo: null, price: 70, hours: 1, cost: 32 },
  ],
};

const turfMow: TierMatrixRule = {
  type: "tier_matrix",
  quantityKey: "turf_sqft",
  rows: [
    { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
    { upTo: 10000, price: 55, hours: 0.75, cost: 24 },
    { upTo: null, price: 70, hours: 1, cost: 32 },
  ],
};

const modifiers = { ...defaultModifiers(), minimum: { price: 0, hours: 0 } };

describe("roughEstimateForOffice", () => {
  it("prices the lead from lot size through the pricing engine", () => {
    const estimate = roughEstimateForOffice({
      lotSqft: 15000,
      rules: [{ config: lotMow, modifiers }],
      orgRole: "sales",
    });
    expect(estimate).toEqual({
      kind: "estimate",
      amount: 55,
      label: ROUGH_ESTIMATE_LABEL,
    });
  });

  it("uses lot size as a rough proxy for turf_sqft catalog rules", () => {
    const estimate = roughEstimateForOffice({
      lotSqft: 8000,
      rules: [{ config: turfMow, modifiers: mergeModifiers(null) }],
      orgRole: "owner",
    });
    expect(estimate?.kind).toBe("estimate");
    if (estimate?.kind !== "estimate") throw new Error("expected estimate");
    // Steep default is not applied; engine prices 8000 turf at the middle band.
    expect(estimate.amount).toBeGreaterThan(0);
    expect(estimate.label).toBe(ROUGH_ESTIMATE_LABEL);
  });

  it("returns no estimate when lot size is missing (not $0)", () => {
    for (const lotSqft of [null, undefined, 0, -1, Number.NaN, ""] as const) {
      expect(
        roughEstimateForOffice({
          lotSqft,
          rules: [{ config: lotMow, modifiers }],
          orgRole: "admin",
        }),
      ).toEqual({ kind: "none" });
    }
  });

  it("hides the estimate from non-office roles", () => {
    expect(
      roughEstimateForOffice({
        lotSqft: 15000,
        rules: [{ config: lotMow, modifiers }],
        orgRole: "crew",
      }),
    ).toEqual({ kind: "hidden" });
  });
});
