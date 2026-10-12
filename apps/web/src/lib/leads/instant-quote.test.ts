import { describe, expect, it } from "vitest";
import {
  abandonedInstantQuote,
  depositLockCopy,
  emptyInstantQuote,
  instantQuoteLeadRow,
  instantQuoteConfigFromSettings,
  instantQuoteStep,
  lawnSqftFromSides,
  type InstantQuoteDraft,
} from "./instant-quote";

const zips = ["37064"];

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
  it("does not price an address outside the service area", () => {
    const outside = draft({ ...inArea, postalCode: "99999", contactName: "Ada", phone: "6155550100" });
    expect(instantQuoteStep(outside, zips)).toBe("outside");
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

  it("reads the service-area list and stated minimum from company settings", () => {
    expect(instantQuoteConfigFromSettings({})).toEqual({
      serviceAreaZips: [],
      statedMinimum: 50,
      depositCents: null,
    });
    expect(
      instantQuoteConfigFromSettings({
        lead_service_area_zips: ["37064"],
        instant_quote_minimum: 75,
        instant_quote_deposit_cents: 2500,
      }),
    ).toEqual({ serviceAreaZips: ["37064"], statedMinimum: 75, depositCents: 2500 });
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
    const long = "u".repeat(250);
    const capped = instantQuoteLeadRow("org-1", draft({
      ...inArea,
      contactName: "Ada",
      email: "ada@example.com",
      utmSource: long,
      utmMedium: long,
      utmCampaign: long,
      utmTerm: long,
      utmContent: long,
    }));
    expect(capped?.utm_source).toHaveLength(200);
    expect(capped?.utm_medium).toHaveLength(200);
    expect(capped?.utm_campaign).toHaveLength(200);
    expect(capped?.utm_term).toHaveLength(200);
    expect(capped?.utm_content).toHaveLength(200);
  });

  it("keeps the deposit locked off until a Stripe key is configured", () => {
    expect(depositLockCopy(false)).toBe("Not connected — add a STRIPE_SECRET_KEY to enable");
    expect(depositLockCopy(true)).toBe("Pay a deposit to lock this range.");
  });
});
