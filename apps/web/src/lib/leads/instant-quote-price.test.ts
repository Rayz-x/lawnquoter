import { describe, expect, it } from "vitest";
import { defaultModifiers } from "@lawnquoter/pricing-engine";
import { emptyInstantQuote, type InstantQuoteDraft } from "./instant-quote";
import { instantQuoteFromCatalog } from "./instant-quote-price";

const mowing = {
  name: "Mowing",
  config: {
    type: "tier_matrix",
    quantityKey: "turf_sqft",
    rows: [
      { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
      { upTo: 10000, price: 55, hours: 0.75, cost: 24 },
      { upTo: null, price: 70, hours: 1, cost: 32 },
    ],
  },
};

const modifiers = {
  ...defaultModifiers(),
  minimum: { price: 0, hours: 0 },
  narrowGate: { extraHours: 0, extraPrice: 8 },
  narrowGateInches: 48,
};

function ready(overrides: Partial<InstantQuoteDraft> = {}): InstantQuoteDraft {
  return {
    ...emptyInstantQuote(),
    address: "1 Oak St",
    postalCode: "37064",
    service: "Mowing",
    hasGate: false,
    hasDogs: false,
    lotSqft: 8000,
    contactName: "Ada",
    email: "ada@example.com",
    ...overrides,
  };
}

const base = {
  serviceAreaZips: ["37064"],
  statedMinimum: 50,
  rules: [mowing],
  modifiers,
  confidence: 0.4,
};

describe("instant quote catalog price", () => {
  it("prices the matching catalog rule and widens a low-confidence measurement", () => {
    // 8,000 sq ft lands in the $55 tier. Confidence 0.4 is the low band, 0.88–1.18 → $48.40–$64.90.
    // The stated minimum lifts the low end to $50.
    expect(instantQuoteFromCatalog({ draft: ready(), ...base })).toEqual({
      low: 50,
      high: 64.9,
      statedMinimum: 50,
      confirm: "We'll confirm within 24 hours",
    });
  });

  it("adds the narrow-gate modifier when the customer has a gate", () => {
    // $55 + $8 gate = $63. Low band is $55.44–$74.34, already above the $50 minimum.
    expect(instantQuoteFromCatalog({ draft: ready({ hasGate: true }), ...base })).toEqual({
      low: 55.44,
      high: 74.34,
      statedMinimum: 50,
      confirm: "We'll confirm within 24 hours",
    });
  });

  it("returns no price before contact, outside the area, or without a matching rule", () => {
    expect(instantQuoteFromCatalog({ draft: ready({ email: "", contactName: "" }), ...base })).toBeNull();
    expect(instantQuoteFromCatalog({ draft: ready({ postalCode: "99999" }), ...base })).toBeNull();
    expect(instantQuoteFromCatalog({ draft: ready(), ...base, rules: [{ name: "Mulch", config: mowing.config }] })).toBeNull();
  });
});
