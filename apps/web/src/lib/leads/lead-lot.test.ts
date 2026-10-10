import { describe, expect, it } from "vitest";
import { defaultModifiers, type TierMatrixRule } from "@lawnquoter/pricing-engine";
import { lotSqftFromLead } from "./lead-lot";
import { roughEstimateForOffice } from "./rough-estimate";

const lotMow: TierMatrixRule = {
  type: "tier_matrix",
  quantityKey: "lot_sqft",
  rows: [{ upTo: null, price: 50, hours: 0.5, cost: 20 }],
};

describe("lotSqftFromLead", () => {
  it("wires a lead row lot size into the office estimate", () => {
    const lotSqft = lotSqftFromLead({ lot_sqft: 12000 });
    const estimate = roughEstimateForOffice({
      lotSqft,
      rules: [{ config: lotMow, modifiers: { ...defaultModifiers(), minimum: { price: 0, hours: 0 } } }],
      orgRole: "sales",
    });
    expect(estimate).toMatchObject({ kind: "estimate", amount: 50 });
  });

  it("yields no estimate when the lead has no lot size", () => {
    expect(lotSqftFromLead({})).toBeNull();
    expect(lotSqftFromLead(null)).toBeNull();
    expect(
      roughEstimateForOffice({
        lotSqft: lotSqftFromLead({ lot_sqft: null }),
        rules: [{ config: lotMow, modifiers: defaultModifiers() }],
        orgRole: "sales",
      }),
    ).toEqual({ kind: "none" });
  });
});
