import { describe, expect, it } from "vitest";
import { deliverSms, inboundSms, mayText, readTwilioConfig, toE164 } from "./sms";

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
    expect(sent.body).toContain("Body=Quote+is+ready");
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
});
