import { createHmac, timingSafeEqual } from "node:crypto";
import { smsNumberAssignedToOrg, toE164, type TwilioConfig } from "./sms";

export const CALLRAIL_NOT_CONNECTED = "Not connected - add CallRail key to enable";

export type TrackedCall = {
  from: string;
  to: string;
  recordingUrl: string | null;
  duration: number | null;
  providerId: string;
  direction: "in" | "out";
};

export function readCallrailSecret(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === "test" || env.VITEST) return null;
  const secret = env.CALLRAIL_WEBHOOK_SECRET?.trim() ?? "";
  return secret || null;
}

function sameSecret(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function callrailCall(input: {
  secret: string | null;
  provided: string | null;
  payload: Record<string, unknown>;
}): { ok: true } & TrackedCall | { ok: false; status: number; error: string } {
  if (!input.secret) return { ok: false, status: 503, error: "not_connected" };
  if (!sameSecret(input.secret, input.provided)) return { ok: false, status: 403, error: "invalid_signature" };
  const from = toE164(String(input.payload.customer_phone_number ?? ""));
  const to = toE164(String(input.payload.tracking_phone_number ?? ""));
  const providerId = String(input.payload.id ?? "").trim();
  if (!from || !to || !providerId) return { ok: false, status: 400, error: "invalid_call" };
  const recording = String(input.payload.recording ?? "").trim();
  const duration = Number(input.payload.duration);
  const direction = input.payload.direction === "outbound" ? "out" : "in";
  return {
    ok: true,
    from,
    to,
    recordingUrl: recording || null,
    duration: Number.isFinite(duration) ? duration : null,
    providerId,
    direction,
  };
}

/** A tracking number is this company's only when Twilio lists it under the company id. */
export async function trackingNumberAssignedToOrg(input: {
  config: TwilioConfig | null;
  orgId: string;
  trackingNumber: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<{ ok: true; trackingNumber: string } | { ok: false; error: string }> {
  const assigned = await smsNumberAssignedToOrg({
    config: input.config,
    orgId: input.orgId,
    smsNumber: input.trackingNumber,
    fetch: input.fetch,
  });
  if (!assigned.ok) return assigned;
  return { ok: true, trackingNumber: assigned.smsNumber };
}

export function trackedCallActivityMeta(providerId: string): { provider_id: string } {
  return { provider_id: providerId };
}

function signatureFor(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params).sort().reduce((acc, key) => acc + key + (params[key] ?? ""), url);
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

export function twilioRecording(input: {
  config: TwilioConfig | null;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}): { ok: true } & TrackedCall | { ok: false; status: number; error: string } {
  if (!input.config) return { ok: false, status: 503, error: "not_connected" };
  const expected = signatureFor(input.config.authToken, input.url, input.params);
  if (!sameSecret(expected, input.signature)) return { ok: false, status: 403, error: "invalid_signature" };
  const from = toE164(input.params.From ?? "");
  const to = toE164(input.params.To ?? "");
  const providerId = (input.params.CallSid ?? "").trim();
  if (!from || !to || !providerId) return { ok: false, status: 400, error: "invalid_call" };
  const duration = Number(input.params.RecordingDuration);
  return {
    ok: true,
    from,
    to,
    recordingUrl: (input.params.RecordingUrl ?? "").trim() || null,
    duration: Number.isFinite(duration) ? duration : null,
    providerId,
    direction: "in",
  };
}
