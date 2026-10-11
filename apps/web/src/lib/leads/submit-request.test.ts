import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEAD_INTAKE_IP_LIMIT,
  submitPublicLeadRequest,
  type LeadIntakeDeps,
  type LeadIntakeInput,
} from "./submit-request";

function baseInput(overrides: Partial<LeadIntakeInput> = {}): LeadIntakeInput {
  return {
    slug: "acme-lawn",
    contactName: "Jane Doe",
    addressTyped: "123 Main St, Austin, TX 78701",
    phone: "5125551212",
    email: null,
    turnstileToken: "token-ok",
    honeypot: "",
    formStartedAtMs: Date.now() - 10_000,
    smsConsent: false,
    services: ["mowing"],
    note: null,
    isBusiness: false,
    preferredContact: null,
    heardAbout: null,
    heardAboutOther: null,
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "spring",
    utmTerm: null,
    utmContent: null,
    referrer: "https://google.com",
    landingPage: "https://example.com/r/acme-lawn",
    clientIp: "203.0.113.10",
    userAgent: "vitest",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<LeadIntakeDeps> = {}): LeadIntakeDeps {
  return {
    findOrgBySlug: vi.fn(async () => ({
      orgId: "org-1",
      consentTextVersion: "v1",
      defaultAssigneeId: "user-owner",
    })),
    countRecentByIpHash: vi.fn(async () => 0),
    countRecentByOrg: vi.fn(async () => 0),
    geocode: vi.fn(async () => ({
      score: 0.9,
      line1: "123 Main St",
      city: "Austin",
      region: "TX",
      postalCode: "78701",
      country: "US",
      lng: -97.74,
      lat: 30.27,
      attribution: "Esri",
      raw: { ok: true },
    })),
    findOpenRequestForFold: vi.fn(async () => null),
    foldIntoOpenRequest: vi.fn(async () => ({ id: "lead-open" })),
    findMatchSources: vi.fn(async () => ({ accounts: [], properties: [] })),
    insertLead: vi.fn(async () => ({ id: "lead-1" })),
    verifyTurnstile: vi.fn(async () => true),
    nowMs: () => Date.now(),
    ...overrides,
  };
}

describe("submitPublicLeadRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid Turnstile token before geocode or storage", async () => {
    const deps = makeDeps({
      verifyTurnstile: vi.fn(async () => false),
    });

    const result = await submitPublicLeadRequest(baseInput(), deps);

    expect(result).toEqual({ ok: false, reason: "turnstile" });
    expect(vi.mocked(deps.geocode)).not.toHaveBeenCalled();
    expect(vi.mocked(deps.insertLead)).not.toHaveBeenCalled();
  });

  it("stores honeypot submissions as spam and skips geocode", async () => {
    const deps = makeDeps();

    const result = await submitPublicLeadRequest(baseInput({ honeypot: "http://spam.test" }), deps);

    expect(result).toEqual({ ok: true, status: "spam" });
    expect(vi.mocked(deps.geocode)).not.toHaveBeenCalled();
    expect(vi.mocked(deps.insertLead)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.insertLead).mock.calls[0]?.[0]).toMatchObject({
      status: "spam",
      spamScore: expect.any(Number),
    });
    expect(vi.mocked(deps.insertLead).mock.calls[0]?.[0].spamScore).toBeGreaterThan(0);
  });

  it("rejects the N+1 submission from one IP hash", async () => {
    const deps = makeDeps({
      countRecentByIpHash: vi.fn(async () => LEAD_INTAKE_IP_LIMIT),
    });

    const result = await submitPublicLeadRequest(baseInput(), deps);

    expect(result).toEqual({ ok: false, reason: "rate_limit" });
    expect(vi.mocked(deps.geocode)).not.toHaveBeenCalled();
    expect(vi.mocked(deps.insertLead)).not.toHaveBeenCalled();
  });

  it("returns the same generic success shape for a clean store", async () => {
    const deps = makeDeps();
    const result = await submitPublicLeadRequest(baseInput(), deps);
    expect(result).toEqual({ ok: true, status: "new" });
    expect(vi.mocked(deps.geocode)).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.insertLead)).toHaveBeenCalledOnce();
  });

  it("matches the same phone in a different format against an existing account", async () => {
    const deps = makeDeps({
      findMatchSources: vi.fn(async () => ({
        accounts: [
          {
            id: "acct-1",
            name: "Jane Doe",
            phone: "+15125551212",
            email: null,
          },
        ],
        properties: [],
      })),
    });

    const result = await submitPublicLeadRequest(baseInput({ phone: "(512) 555-1212" }), deps);

    expect(result).toEqual({ ok: true, status: "new" });
    expect(vi.mocked(deps.insertLead).mock.calls[0]?.[0]).toMatchObject({
      phone: "+15125551212",
      accountId: null,
      propertyId: null,
    });
  });

  it("auto-links an exact property match without merging other candidates", async () => {
    const deps = makeDeps({
      findMatchSources: vi.fn(async () => ({
        accounts: [
          {
            id: "acct-1",
            name: "Jane Doe",
            phone: "+15125551212",
            email: null,
          },
        ],
        properties: [
          {
            id: "prop-1",
            accountId: "acct-1",
            accountName: "Jane Doe",
            addressKey: "123 main st|austin|tx|78701",
            lat: 30.27,
            lng: -97.74,
          },
        ],
      })),
    });

    await submitPublicLeadRequest(baseInput(), deps);

    expect(vi.mocked(deps.insertLead).mock.calls[0]?.[0]).toMatchObject({
      accountId: "acct-1",
      propertyId: "prop-1",
    });
  });

  it("folds a duplicate submit within the short window into one open request", async () => {
    const now = Date.parse("2026-10-11T00:00:00.000Z");
    const deps = makeDeps({
      nowMs: () => now,
      findOpenRequestForFold: vi.fn(async () => ({
        id: "lead-open",
        phone: "+15125551212",
        email: null,
        status: "new",
        createdAtMs: now - 60_000,
      })),
      foldIntoOpenRequest: vi.fn(async () => ({ id: "lead-open" })),
    });

    const result = await submitPublicLeadRequest(
      baseInput({ phone: "(512) 555-1212", formStartedAtMs: now - 10_000 }),
      deps,
    );

    expect(result).toEqual({ ok: true, status: "new", folded: true });
    expect(vi.mocked(deps.foldIntoOpenRequest)).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.insertLead)).not.toHaveBeenCalled();
  });
});
