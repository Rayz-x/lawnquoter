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
    insertLead: vi.fn(async () => ({ id: "lead-1" })),
    listOpenLeadsForFold: vi.fn(async () => []),
    listMatchCandidates: vi.fn(async () => []),
    foldIntoLead: vi.fn(async ({ leadId }) => ({ id: leadId })),
    uploadLeadPhotos: vi.fn(async () => ["org-1/lead-1/a.jpg"]),
    verifyTurnstile: vi.fn(async () => true),
    nowMs: () => Date.now(),
    ...overrides,
  };
}

function jpegPhoto(byteLength = 1_024) {
  return {
    mimeType: "image/jpeg",
    byteLength,
    body: new Uint8Array(byteLength),
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

  it("rejects a fourth image before upload", async () => {
    const deps = makeDeps();
    const result = await submitPublicLeadRequest(
      baseInput({
        photos: [jpegPhoto(), jpegPhoto(), jpegPhoto(), jpegPhoto()],
      }),
      deps,
    );

    expect(result).toEqual({ ok: false, reason: "validation" });
    expect(vi.mocked(deps.verifyTurnstile)).not.toHaveBeenCalled();
    expect(vi.mocked(deps.uploadLeadPhotos)).not.toHaveBeenCalled();
    expect(vi.mocked(deps.insertLead)).not.toHaveBeenCalled();
  });

  it("rejects a non-image attachment before upload", async () => {
    const deps = makeDeps();
    const result = await submitPublicLeadRequest(
      baseInput({
        photos: [
          {
            mimeType: "application/pdf",
            byteLength: 1_024,
            body: new Uint8Array(1_024),
          },
        ],
      }),
      deps,
    );

    expect(result).toEqual({ ok: false, reason: "validation" });
    expect(vi.mocked(deps.uploadLeadPhotos)).not.toHaveBeenCalled();
  });

  it("does not upload photos when the bot check fails", async () => {
    const deps = makeDeps({
      verifyTurnstile: vi.fn(async () => false),
    });

    const result = await submitPublicLeadRequest(
      baseInput({ photos: [jpegPhoto()] }),
      deps,
    );

    expect(result).toEqual({ ok: false, reason: "turnstile" });
    expect(vi.mocked(deps.uploadLeadPhotos)).not.toHaveBeenCalled();
    expect(vi.mocked(deps.insertLead)).not.toHaveBeenCalled();
  });

  it("uploads photos only after the bot check and lead insert", async () => {
    const order: string[] = [];
    const deps = makeDeps({
      verifyTurnstile: vi.fn(async () => {
        order.push("turnstile");
        return true;
      }),
      insertLead: vi.fn(async () => {
        order.push("insert");
        return { id: "lead-1" };
      }),
      uploadLeadPhotos: vi.fn(async () => {
        order.push("upload");
        return ["org-1/lead-1/a.jpg"];
      }),
    });

    const result = await submitPublicLeadRequest(
      baseInput({ photos: [jpegPhoto()] }),
      deps,
    );

    expect(result).toEqual({ ok: true, status: "new" });
    expect(order).toEqual(["turnstile", "insert", "upload"]);
    expect(vi.mocked(deps.uploadLeadPhotos)).toHaveBeenCalledWith({
      orgId: "org-1",
      leadId: "lead-1",
      photos: [expect.objectContaining({ mimeType: "image/jpeg" })],
    });
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

  it("matches the same phone in a different format to an exact property", async () => {
    const deps = makeDeps({
      listMatchCandidates: vi.fn(async () => [
        {
          accountId: "acct-1",
          accountName: "Jane Doe",
          propertyId: "prop-1",
          addressLine1: "123 Main St",
          city: "Austin",
          postalCode: "78701",
          formattedAddress: "123 Main St, Austin, TX 78701",
          accountPhone: "+15125551212",
          accountEmail: null,
          distanceM: null,
        },
      ]),
    });

    const result = await submitPublicLeadRequest(baseInput({ phone: "(512) 555-1212" }), deps);

    expect(result).toEqual({ ok: true, status: "new" });
    expect(vi.mocked(deps.insertLead).mock.calls[0]?.[0]).toMatchObject({
      phone: "+15125551212",
      accountId: "acct-1",
      propertyId: "prop-1",
    });
  });

  it("folds a duplicate submit within the window into one open request", async () => {
    const now = Date.parse("2026-10-11T12:00:00.000Z");
    const deps = makeDeps({
      nowMs: () => now,
      listOpenLeadsForFold: vi.fn(async () => [
        {
          id: "lead-open",
          phone: "+15125551212",
          email: null,
          status: "new",
          createdAtMs: now - 30_000,
        },
      ]),
    });

    const result = await submitPublicLeadRequest(
      baseInput({ phone: "512-555-1212", formStartedAtMs: now - 10_000 }),
      deps,
    );

    expect(result).toEqual({ ok: true, status: "new" });
    expect(vi.mocked(deps.foldIntoLead)).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-open", orgId: "org-1" }),
    );
    expect(vi.mocked(deps.insertLead)).not.toHaveBeenCalled();
  });
});
