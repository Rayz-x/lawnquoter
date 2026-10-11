import { describe, expect, it, vi } from "vitest";
import {
  buildHostedIntakeBody,
  formatExpectedReply,
  submitHostedQuoteRequest,
  type HostedQuoteFormState,
} from "./public-form-payload";

function baseState(overrides: Partial<HostedQuoteFormState> = {}): HostedQuoteFormState {
  return {
    slug: "acme-lawn",
    contactName: "Pat Homeowner",
    addressTyped: "123 Oak St, Austin, TX",
    phone: "5125550100",
    email: "",
    services: ["Mowing"],
    note: "",
    preferredContact: "phone",
    isBusiness: false,
    smsConsent: false,
    heardAbout: "Google",
    heardAboutOther: "",
    turnstileToken: "tok",
    honeypot: "",
    formStartedAtMs: 1_700_000_000_000,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    referrer: null,
    landingPage: "https://example.com/r/acme-lawn",
    ...overrides,
  };
}

describe("hosted quote form payload", () => {
  it("defaults smsConsent to false when untouched", () => {
    const body = buildHostedIntakeBody(baseState());
    expect(body.smsConsent).toBe(false);
  });

  it("allows an unknown typed address without requiring a place id", () => {
    const body = buildHostedIntakeBody(
      baseState({ addressTyped: "somewhere near the lake, no match" }),
    );
    expect(body.addressTyped).toBe("somewhere near the lake, no match");
    expect(body).not.toHaveProperty("placeId");
  });

  it("submits only through the intake operation", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/leads/intake");
      expect(init?.method).toBe("POST");
      const parsed = JSON.parse(String(init?.body)) as { smsConsent: boolean; slug: string };
      expect(parsed.slug).toBe("acme-lawn");
      expect(parsed.smsConsent).toBe(false);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const result = await submitHostedQuoteRequest(buildHostedIntakeBody(baseState()), fetchImpl as typeof fetch);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("formatExpectedReply", () => {
  it("formats minutes and hours without prices", () => {
    expect(formatExpectedReply(45)).toBe("We usually reply within 45 minutes.");
    expect(formatExpectedReply(60)).toBe("We usually reply within 1 hour.");
    expect(formatExpectedReply(120)).toBe("We usually reply within 2 hours.");
    expect(formatExpectedReply(60)).not.toMatch(/\$/);
  });
});
