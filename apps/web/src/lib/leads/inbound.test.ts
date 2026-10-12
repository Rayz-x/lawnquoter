import { describe, expect, it } from "vitest";
import {
  facebookSignatureMatches,
  inboundAuthDecision,
  inboundLeadRow,
  leadConnectorStates,
  parseInboundLead,
} from "./inbound";

describe("inbound lead connectors", () => {
  it("stays disconnected until each key is set", () => {
    const states = leadConnectorStates({});
    expect(states.every((state) => state.connected === false)).toBe(true);
    expect(states.map((state) => state.message)).toEqual([
      "Not connected — add GOOGLE_LSA_WEBHOOK_SECRET to enable",
      "Not connected — add THUMBTACK_WEBHOOK_SECRET to enable",
      "Not connected — add YELP_WEBHOOK_SECRET to enable",
      "Not connected — add ANGI_WEBHOOK_SECRET to enable",
      "Not connected — add INBOUND_LEAD_WEBHOOK_SECRET to enable",
      "Not connected — add FACEBOOK_APP_SECRET to enable",
      "Not connected — add FACEBOOK_LEAD_ADS_VERIFY_TOKEN to enable",
      "Not connected — add FACEBOOK_PAGE_ACCESS_TOKEN to enable",
    ]);
    const withThumbtack = leadConnectorStates({ THUMBTACK_WEBHOOK_SECRET: "live" });
    expect(withThumbtack.find((state) => state.id === "thumbtack")?.connected).toBe(true);
  });

  it("requires a name and a phone or email before a lead can be stored", () => {
    expect(parseInboundLead({ contactName: "Ada" })).toBeNull();
    expect(parseInboundLead({ contactName: "Ada", phone: "6155550100", address: "1 Oak St", utmSource: "cpc" })).toEqual({
      contactName: "Ada",
      phone: "6155550100",
      email: null,
      address: "1 Oak St",
      utmSource: "cpc",
      utmMedium: null,
      utmCampaign: null,
    });
  });

  it("refuses the webhook when the connector key is missing", () => {
    expect(inboundAuthDecision(undefined, "Bearer secret", "THUMBTACK_WEBHOOK_SECRET")).toEqual({
      ok: false,
      status: 503,
      message: "Not connected — add THUMBTACK_WEBHOOK_SECRET to enable",
    });
    expect(inboundAuthDecision("secret", "Bearer secret", "THUMBTACK_WEBHOOK_SECRET")).toEqual({ ok: true });
    expect(inboundAuthDecision("secret", "Bearer wrong", "THUMBTACK_WEBHOOK_SECRET").ok).toBe(false);
  });

  it("stores the contact without a price", () => {
    const lead = parseInboundLead({ contactName: "Ada", email: "ada@example.com" });
    expect(lead && inboundLeadRow("org-1", "Thumbtack", lead)).toMatchObject({
      org_id: "org-1",
      contact_name: "Ada",
      email: "ada@example.com",
      source: "Thumbtack",
      address_typed: "Not provided",
    });
  });

  it("checks the Facebook signature against the raw body", () => {
    const body = '{"leadgen_id":"1"}';
    const digest = "a281d24ff3c6a7dbfa5735f95ac1c56913cac767d9900b9752b7b60098fafa21";
    expect(facebookSignatureMatches("app-secret", body, `sha256=${digest}`)).toBe(true);
    expect(facebookSignatureMatches("app-secret", body, "sha256=nope")).toBe(false);
  });
});
