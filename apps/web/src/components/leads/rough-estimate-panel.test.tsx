import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultModifiers, type TierMatrixRule } from "@lawnquoter/pricing-engine";
import { describe, expect, it } from "vitest";
import { ROUGH_ESTIMATE_LABEL } from "@/lib/leads/rough-estimate";
import { RoughEstimatePanel } from "./rough-estimate-panel";

const lotMow: TierMatrixRule = {
  type: "tier_matrix",
  quantityKey: "lot_sqft",
  rows: [
    { upTo: 10000, price: 40, hours: 0.5, cost: 18 },
    { upTo: 20000, price: 55, hours: 0.75, cost: 24 },
    { upTo: null, price: 70, hours: 1, cost: 32 },
  ],
};

const modifiers = { ...defaultModifiers(), minimum: { price: 0, hours: 0 } };

describe("RoughEstimatePanel", () => {
  it("shows the priced amount and rough label for office roles", () => {
    const markup = renderToStaticMarkup(
      createElement(RoughEstimatePanel, {
        lotSqft: 15000,
        rules: [{ config: lotMow, modifiers }],
        orgRole: "dispatcher",
      }),
    );
    expect(markup).toContain("$55");
    expect(markup).toContain(ROUGH_ESTIMATE_LABEL);
    expect(markup).toContain('data-weight="internal"');
  });

  it("renders nothing for crew roles", () => {
    const markup = renderToStaticMarkup(
      createElement(RoughEstimatePanel, {
        lotSqft: 15000,
        rules: [{ config: lotMow, modifiers }],
        orgRole: "crew",
      }),
    );
    expect(markup).toBe("");
  });

  it("renders nothing when lot size is missing (not $0)", () => {
    const markup = renderToStaticMarkup(
      createElement(RoughEstimatePanel, {
        lotSqft: null,
        rules: [{ config: lotMow, modifiers }],
        orgRole: "sales",
      }),
    );
    expect(markup).toBe("");
    expect(markup).not.toContain("$0");
  });
});
