import { describe, expect, it } from "vitest";
import {
  abandonedInstantQuote,
  depositLockCopy,
  emptyInstantQuote,
  instantQuoteLeadRow,
  instantQuoteConfigFromSettings,
  instantQuoteOffer,
  instantQuoteStep,
  lawnSqftFromSides,
  type InstantQuoteDraft,
} from "./instant-quote";

const zips = ["37064"];
const config = { serviceAreaZips: zips, ratePerSqft: 0.01, statedMinimum: 50 };

function draft(overrides: Partial<InstantQuoteDraft> = {}): InstantQuoteDraft {
  return { ...emptyInstantQuote(), ...overrides };
}

const inArea = {
  address: "1 Oak St",
  postalCode: "37064",
  service: "Mowing",
  hasGate: false,
  hasDogs: false,
  lotSqft: 10_000,
} as const;

describe("instant quote session", () => {
  it("hides every price until a name and a phone or email are captured", () => {
    expect(instantQuoteOffer(draft(inArea), config)).toBeNull();
    // 10,000 sq ft × $0.01 = $100. Low confidence is 0.88–1.18 → $88–$118.
    expect(instantQuoteOffer(draft({ ...inArea, contactName: "Ada", email: "ada@example.com" }), config)).toEqual({
      low: 88,
      high: 118,
      statedMinimum: 50,
      confirm: "We'll confirm within 24 hours",
    });
  });

  it("does not price an address outside the service area", () => {
    const outside = draft({ ...inArea, postalCode: "99999", contactName: "Ada", phone: "6155550100" });
    expect(instantQuoteStep(outside, zips)).toBe("outside");
    expect(instantQuoteOffer(outside, config)).toBeNull();
  });

  it("raises the low end to the stated minimum when the band sits below it", () => {
    // $40 point → $35.20–$47.20, minimum $50, so the shown range is $50–$50.
    const small = draft({ ...inArea, lotSqft: 4_000, contactName: "Ada", email: "ada@example.com" });
    expect(instantQuoteOffer(small, config)).toEqual({
      low: 50,
      high: 50,
      statedMinimum: 50,
      confirm: "We'll confirm within 24 hours",
    });
  });

  it("walks address, questions, and lawn size before asking for contact", () => {
    expect(instantQuoteStep(emptyInstantQuote(), zips)).toBe("address");
    const addressed = draft({ address: "1 Oak St", postalCode: "37064" });
    expect(instantQuoteStep(addressed, zips)).toBe("qualify");
    const qualified = { ...addressed, service: "Mowing", hasGate: true, hasDogs: false };
    expect(instantQuoteStep(qualified, zips)).toBe("measure");
    expect(instantQuoteStep({ ...qualified, lotSqft: lawnSqftFromSides(100, 100) }, zips)).toBe("contact");
    expect(lawnSqftFromSides(100, 100)).toBe(10_000);
    expect(lawnSqftFromSides(0, 20)).toBeNull();
  });

  it("records an abandoned quote only when an address exists and contact does not", () => {
    expect(abandonedInstantQuote(emptyInstantQuote())).toBeNull();
    const started = draft({
      address: "1 Oak St",
      postalCode: "37064",
      utmSource: "facebook",
      utmMedium: "cpc",
      utmCampaign: "spring",
      utmTerm: "mowing",
      utmContent: "hero",
    });
    expect(abandonedInstantQuote(started)).toMatchObject({
      address: "1 Oak St",
      postalCode: "37064",
      utmSource: "facebook",
      utmContent: "hero",
    });
    expect(abandonedInstantQuote({ ...started, email: "ada@example.com" })).toBeNull();
  });

  it("reads the service-area list, rate, and stated minimum from company settings", () => {
    expect(instantQuoteConfigFromSettings({})).toEqual({
      serviceAreaZips: [],
      ratePerSqft: 0.01,
      statedMinimum: 50,
    });
    expect(
      instantQuoteConfigFromSettings({
        lead_service_area_zips: ["37064"],
        instant_quote_rate_per_sqft: 0.02,
        instant_quote_minimum: 75,
      }),
    ).toEqual({ serviceAreaZips: ["37064"], ratePerSqft: 0.02, statedMinimum: 75 });
  });

  it("stores the contact and UTM on the lead and leaves the price off the row", () => {
    expect(instantQuoteLeadRow("org-1", draft(inArea))).toBeNull();
    const row = instantQuoteLeadRow("org-1", draft({
      ...inArea,
      contactName: "Ada",
      email: "ada@example.com",
      utmSource: "facebook",
    }));
    expect(row).toMatchObject({
      org_id: "org-1",
      contact_name: "Ada",
      email: "ada@example.com",
      source: "Website form",
      utm_source: "facebook",
      needs_address_check: true,
    });
    expect(row && "low" in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain("88");
  });

  it("keeps the deposit locked off until a Stripe key is configured", () => {
    expect(depositLockCopy(false)).toBe("Not connected — add a STRIPE_SECRET_KEY to enable");
    expect(depositLockCopy(true)).toBe("Pay a deposit to lock this range.");
  });
});
