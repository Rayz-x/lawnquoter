import { describe, expect, it } from "vitest";
import { claimedSmsFrom, deliverSms, inboundSms, mayText, readTwilioConfig, resolveInboundOrg, smsNumberAssignedToOrg, toE164 } from "./sms";

const url = "https://app.example.com/api/webhooks/twilio/sms";
const params = { Body: "On my way", From: "+15551110000", MessageSid: "SM123", To: "+15552220000" };
const signature = "vBo8L1gQZD7ZzzqqNKf27mvbRG8=";

describe("Twilio SMS", () => {
  it("stays off until the account, token, and from number are all set", () => {
    expect(readTwilioConfig({})).toBeNull();
    expect(readTwilioConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "secret" })).toBeNull();
    expect(readTwilioConfig({ NODE_ENV: "test", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "secret", TWILIO_FROM_NUMBER: "+15552220000" })).toBeNull();
    expect(readTwilioConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "secret", TWILIO_FROM_NUMBER: "+15552220000" })).toEqual({
      accountSid: "AC1",
      authToken: "secret",
      fromNumber: "+15552220000",
    });
  });

  it("does not call Twilio when texting is not connected", async () => {
    const calls: string[] = [];
    const result = await deliverSms({
      config: null,
      to: "5551110000",
      body: "Hello",
      fetch: async (target) => {
        calls.push(String(target));
        return new Response("{}", { status: 200 });
      },
    });
    expect(result).toEqual({ sent: false, reason: "not_connected" });
    expect(calls).toEqual([]);
  });

  it("posts a text to the Twilio messages API", async () => {
    let sent: { url?: string; auth?: string; body?: string } = {};
    const result = await deliverSms({
      config: { accountSid: "AC1", authToken: "secret", fromNumber: "+15552220000" },
      to: "(555) 111-0000",
      from: "5553330000",
      body: "Quote is ready",
      fetch: async (target, init) => {
        sent = { url: String(target), auth: new Headers(init?.headers).get("authorization") ?? "", body: String(init?.body) };
        return new Response(JSON.stringify({ sid: "SM999" }), { status: 201 });
      },
    });
    expect(result).toEqual({ sent: true, sid: "SM999" });
    expect(sent.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect(sent.auth).toBe(`Basic ${Buffer.from("AC1:secret").toString("base64")}`);
    expect(sent.body).toContain("To=%2B15551110000");
    expect(sent.body).toContain("From=%2B15553330000");
    expect(sent.body).not.toContain("From=%2B15552220000");
    expect(sent.body).toContain("Body=Quote+is+ready");
  });

  it("does not send from the shared Twilio number when the company has not claimed one", async () => {
    const calls: string[] = [];
    const result = await deliverSms({
      config: { accountSid: "AC1", authToken: "secret", fromNumber: "+15552220000" },
      to: "5551110000",
      body: "Hello",
      fetch: async (target) => {
        calls.push(String(target));
        return new Response("{}", { status: 200 });
      },
    });
    expect(result).toEqual({ sent: false, reason: "rejected" });
    expect(calls).toEqual([]);
    expect(claimedSmsFrom(null)).toBeNull();
    expect(claimedSmsFrom("  ")).toBeNull();
    expect(claimedSmsFrom("(555) 333-0000")).toBe("+15553330000");
  });

  it("accepts a signed inbound text and rejects a missing signature", () => {
    const config = { accountSid: "AC1", authToken: "auth-token", fromNumber: "+15552220000" };
    expect(inboundSms({ config, url, params, signature })).toEqual({ ok: true, from: "+15551110000", to: "+15552220000", body: "On my way", sid: "SM123" });
    expect(inboundSms({ config: null, url, params, signature })).toEqual({ ok: false, status: 503, error: "not_connected" });
    expect(inboundSms({ config, url, params, signature: "nope" }).ok).toBe(false);
  });

  it("allows a text when the person opted in or already texted us", () => {
    expect(mayText({ optedIn: true, inbound: false })).toEqual({ ok: true });
    expect(mayText({ optedIn: false, inbound: true })).toEqual({ ok: true });
    expect(mayText({ optedIn: false, inbound: false })).toEqual({ ok: false, error: "This person has not agreed to texts." });
    expect(toE164("5551110000")).toBe("+15551110000");
  });

  it("accepts only a Twilio number assigned to this company", async () => {
    const config = { accountSid: "AC1", authToken: "secret", fromNumber: "+15552220000" };
    const calls: string[] = [];
    const disconnected = await smsNumberAssignedToOrg({
      config: null,
      orgId: "org-a",
      smsNumber: "+15553330000",
      fetch: async (target) => {
        calls.push(String(target));
        return new Response("{}", { status: 200 });
      },
    });
    expect(disconnected).toEqual({ ok: false, error: "Not connected - add Twilio keys to enable" });
    expect(calls).toEqual([]);

    const listed = async (numbers: { phone_number?: string; friendly_name?: string }[], status = 200) => {
      const seen: { url?: string; auth?: string } = {};
      const result = await smsNumberAssignedToOrg({
        config,
        orgId: "org-a",
        smsNumber: "(555) 333-0000",
        fetch: async (target, init) => {
          seen.url = String(target);
          seen.auth = new Headers(init?.headers).get("authorization") ?? "";
          return new Response(JSON.stringify({ incoming_phone_numbers: numbers }), { status });
        },
      });
      return { result, seen };
    };

    const assigned = await listed([{ phone_number: "+15553330000", friendly_name: "org-a" }]);
    expect(assigned.result).toEqual({ ok: true, smsNumber: "+15553330000" });
    expect(assigned.seen.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers.json?PhoneNumber=%2B15553330000");
    expect(assigned.seen.auth).toBe(`Basic ${Buffer.from("AC1:secret").toString("base64")}`);

    const otherCompany = await listed([{ phone_number: "+15553330000", friendly_name: "org-b" }]);
    expect(otherCompany.result).toEqual({ ok: false, error: "That number is not assigned to this company." });

    const missing = await listed([]);
    expect(missing.result).toEqual({ ok: false, error: "That number is not assigned to this company." });

    const rejected = await listed([{ phone_number: "+15553330000", friendly_name: "org-a" }], 401);
    expect(rejected.result).toEqual({ ok: false, error: "Twilio could not confirm that number." });
  });

  it("gives an inbound text only to the company that claimed the number", () => {
    expect(resolveInboundOrg({ claimedOrgId: "org-a", claimedAmbiguous: false })).toBe("org-a");
    expect(resolveInboundOrg({ claimedOrgId: "org-a", claimedAmbiguous: true })).toBeNull();
    expect(resolveInboundOrg({ claimedOrgId: null, claimedAmbiguous: false })).toBeNull();
  });
});
