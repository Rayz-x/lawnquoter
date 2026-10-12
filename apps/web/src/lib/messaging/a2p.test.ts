import { describe, expect, it } from "vitest";
import { a2pCanSubmit, a2pStep, parseA2pDraft, submitA2p } from "./a2p";
import { TWILIO_NOT_CONNECTED } from "./sms";

const draft = {
  legalName: "North Lawn LLC",
  ein: "12-3456789",
  website: "https://northlawn.example",
  email: "owner@northlawn.example",
  sample: "North Lawn: your quote is ready. Reply STOP to opt out.",
};

const draftRegistration = { brandStatus: "draft", campaignStatus: "draft", brandSid: null, campaignSid: null };

describe("10DLC onboarding", () => {
  it("does not call Twilio until the keys exist", async () => {
    const calls: string[] = [];
    const result = await submitA2p({
      config: null,
      draft,
      registration: draftRegistration,
      fetch: async (url) => {
        calls.push(String(url));
        return new Response("{}", { status: 201 });
      },
    });
    expect(result).toEqual({ ok: false, error: TWILIO_NOT_CONNECTED });
    expect(calls).toEqual([]);
  });

  it("rejects an EIN that is not 9 digits before any request", async () => {
    const calls: string[] = [];
    const result = await submitA2p({
      config: { accountSid: "AC1", authToken: "secret", fromNumber: "+15552220000" },
      draft: { ...draft, ein: "123" },
      registration: draftRegistration,
      fetch: async (url) => {
        calls.push(String(url));
        return new Response("{}", { status: 201 });
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("submits the brand and the campaign in Twilio's order", async () => {
    const calls: string[] = [];
    const result = await submitA2p({
      config: { accountSid: "AC1", authToken: "secret", fromNumber: "+15552220000" },
      draft,
      registration: draftRegistration,
      fetch: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ sid: `SID${calls.length}` }), { status: 201 });
      },
    });
    expect(result).toEqual({ ok: true, brandSid: "SID6", campaignSid: "SID8", messagingServiceSid: "SID7" });
    expect(calls).toEqual([
      "https://trusthub.twilio.com/v1/CustomerProfiles",
      "https://trusthub.twilio.com/v1/EndUsers",
      "https://trusthub.twilio.com/v1/CustomerProfiles/SID1/EntityAssignments",
      "https://trusthub.twilio.com/v1/TrustProducts",
      "https://trusthub.twilio.com/v1/TrustProducts/SID4/EntityAssignments",
      "https://messaging.twilio.com/v1/a2p/BrandRegistrations",
      "https://messaging.twilio.com/v1/Services",
      "https://messaging.twilio.com/v1/Services/SID7/Compliance/Usa2p",
    ]);
    expect(parseA2pDraft(draft).ok).toBe(true);
    expect(a2pStep({ brandStatus: "pending", campaignStatus: "draft" })).toBe(1);
    expect(a2pStep({ brandStatus: "approved", campaignStatus: "pending" })).toBe(2);
  });

  it("does not create another brand or campaign after a submit", async () => {
    const blocked = [
      { brandStatus: "pending", campaignStatus: "draft", brandSid: null, campaignSid: null },
      { brandStatus: "approved", campaignStatus: "draft", brandSid: null, campaignSid: null },
      { brandStatus: "failed", campaignStatus: "failed", brandSid: null, campaignSid: null },
      { brandStatus: "draft", campaignStatus: "pending", brandSid: null, campaignSid: null },
      { brandStatus: "draft", campaignStatus: "approved", brandSid: null, campaignSid: null },
      { brandStatus: "draft", campaignStatus: "draft", brandSid: "BN1", campaignSid: null },
      { brandStatus: "draft", campaignStatus: "draft", brandSid: null, campaignSid: "QE1" },
    ];
    for (const registration of blocked) {
      const calls: string[] = [];
      const result = await submitA2p({
        config: { accountSid: "AC1", authToken: "secret", fromNumber: "+15552220000" },
        draft,
        registration,
        fetch: async (url) => {
          calls.push(String(url));
          return new Response(JSON.stringify({ sid: "SID" }), { status: 201 });
        },
      });
      expect(result).toEqual({ ok: false, error: "This registration was already submitted to the carriers." });
      expect(calls).toEqual([]);
      expect(a2pCanSubmit(registration)).toBe(false);
    }
    expect(a2pCanSubmit({ brandStatus: "draft", campaignStatus: "draft", brandSid: null, campaignSid: null })).toBe(true);
  });
});
