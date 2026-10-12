import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callrailCall, readCallrailSecret, trackedCallActivityMeta, trackingNumberAssignedToOrg, twilioRecording } from "./calls";
import { CALLRAIL_NOT_CONNECTED } from "./calls";

const voiceUrl = "https://app.example.com/api/webhooks/twilio/voice";
const voiceParams = {
  CallSid: "CA123",
  From: "+15551110000",
  RecordingDuration: "42",
  RecordingUrl: "https://api.twilio.com/rec",
  To: "+15552220000",
};

function sign(token: string, url: string, params: Record<string, string>) {
  const payload = Object.keys(params).sort().reduce((acc, key) => acc + key + (params[key] ?? ""), url);
  return createHmac("sha1", token).update(payload).digest("base64");
}

describe("call tracking", () => {
  it("stays off until the CallRail secret is set", () => {
    expect(readCallrailSecret({})).toBeNull();
    expect(readCallrailSecret({ NODE_ENV: "test", CALLRAIL_WEBHOOK_SECRET: "hook" })).toBeNull();
    expect(readCallrailSecret({ CALLRAIL_WEBHOOK_SECRET: "hook" })).toBe("hook");
    const result = callrailCall({ secret: null, provided: "hook", payload: { id: "CAL1" } });
    expect(result).toEqual({ ok: false, status: 503, error: "not_connected" });
  });

  it("accepts a CallRail call with a recording and rejects a bad secret", () => {
    const payload = {
      id: "CAL1",
      customer_phone_number: "(555) 111-0000",
      tracking_phone_number: "+1 555 222 0000",
      recording: "https://app.callrail.com/calls/CAL1/recording",
      duration: 42,
    };
    expect(callrailCall({ secret: "hook", provided: "hook", payload })).toEqual({
      ok: true,
      from: "+15551110000",
      to: "+15552220000",
      recordingUrl: "https://app.callrail.com/calls/CAL1/recording",
      duration: 42,
      providerId: "CAL1",
      direction: "in",
    });
    expect(callrailCall({ secret: "hook", provided: "nope", payload }).ok).toBe(false);
    expect(CALLRAIL_NOT_CONNECTED).toBe("Not connected - add CallRail key to enable");
  });

  it("accepts a signed Twilio recording and ignores an unsigned one", () => {
    const config = { accountSid: "AC1", authToken: "auth-token", fromNumber: "+15552220000" };
    const signature = sign("auth-token", voiceUrl, voiceParams);
    expect(twilioRecording({ config, url: voiceUrl, params: voiceParams, signature })).toEqual({
      ok: true,
      from: "+15551110000",
      to: "+15552220000",
      recordingUrl: "https://api.twilio.com/rec",
      duration: 42,
      providerId: "CA123",
      direction: "in",
    });
    expect(twilioRecording({ config: null, url: voiceUrl, params: voiceParams, signature })).toEqual({
      ok: false,
      status: 503,
      error: "not_connected",
    });
    expect(twilioRecording({ config, url: voiceUrl, params: voiceParams, signature: "nope" }).ok).toBe(false);
  });

  it("accepts only a tracking number Twilio assigned to this company", async () => {
    const config = { accountSid: "AC1", authToken: "secret", fromNumber: "+15552220000" };
    const calls: string[] = [];
    const disconnected = await trackingNumberAssignedToOrg({
      config: null,
      orgId: "org-a",
      trackingNumber: "+15552220000",
      fetch: async (target) => {
        calls.push(String(target));
        return new Response("{}", { status: 200 });
      },
    });
    expect(disconnected).toEqual({ ok: false, error: "Not connected - add Twilio keys to enable" });
    expect(calls).toEqual([]);

    const listed = async (numbers: { phone_number?: string; friendly_name?: string }[]) =>
      trackingNumberAssignedToOrg({
        config,
        orgId: "org-a",
        trackingNumber: "(555) 222-0000",
        fetch: async () => new Response(JSON.stringify({ incoming_phone_numbers: numbers }), { status: 200 }),
      });

    expect(await listed([{ phone_number: "+15552220000", friendly_name: "org-a" }])).toEqual({
      ok: true,
      trackingNumber: "+15552220000",
    });
    expect(await listed([{ phone_number: "+15552220000", friendly_name: "org-b" }])).toEqual({
      ok: false,
      error: "That number is not assigned to this company.",
    });
    expect(await listed([])).toEqual({ ok: false, error: "That number is not assigned to this company." });
  });

  it("keeps the recording on the call, not on the activity the whole company can read", () => {
    expect(trackedCallActivityMeta("CA123")).toEqual({ provider_id: "CA123" });
    expect(trackedCallActivityMeta("CA123")).not.toHaveProperty("recording_url");
  });
});
