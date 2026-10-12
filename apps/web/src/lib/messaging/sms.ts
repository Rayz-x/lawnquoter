import { createHmac, timingSafeEqual } from "node:crypto";

export const TWILIO_NOT_CONNECTED = "Not connected - add Twilio keys to enable";

export type TwilioConfig = { accountSid: string; authToken: string; fromNumber: string };

export function readTwilioConfig(env: Record<string, string | undefined>): TwilioConfig | null {
  if (env.NODE_ENV === "test" || env.VITEST) return null;
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const fromNumber = env.TWILIO_FROM_NUMBER?.trim() ?? "";
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

export function toE164(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
function signatureFor(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params).sort().reduce((acc, key) => acc + key + (params[key] ?? ""), url);
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

function signaturesMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type SmsDelivery = { sent: false; reason: "not_connected" | "rejected" } | { sent: true; sid: string };

export async function deliverSms(input: {
  config: TwilioConfig | null;
  to: string;
  body: string;
  from?: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<SmsDelivery> {
  if (!input.config) return { sent: false, reason: "not_connected" };
  const to = toE164(input.to);
  const from = toE164(input.from ?? input.config.fromNumber);
  if (!to || !from || !input.body.trim()) return { sent: false, reason: "rejected" };
  const response = await input.fetch(`https://api.twilio.com/2010-04-01/Accounts/${input.config.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${input.config.accountSid}:${input.config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: input.body }),
  });
  if (!response.ok) return { sent: false, reason: "rejected" };
  const payload = (await response.json()) as { sid?: string };
  return payload.sid ? { sent: true, sid: payload.sid } : { sent: false, reason: "rejected" };
}

export function inboundSms(input: {
  config: TwilioConfig | null;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}): { ok: true; from: string; to: string; body: string; sid: string } | { ok: false; status: number; error: string } {
  if (!input.config) return { ok: false, status: 503, error: "not_connected" };
  if (!signaturesMatch(signatureFor(input.config.authToken, input.url, input.params), input.signature)) {
    return { ok: false, status: 403, error: "invalid_signature" };
  }
  const from = toE164(input.params.From ?? "");
  const to = toE164(input.params.To ?? "");
  const body = (input.params.Body ?? "").trim();
  const sid = (input.params.MessageSid ?? "").trim();
  if (!from || !to || !body || !sid) return { ok: false, status: 400, error: "invalid_message" };
  return { ok: true, from, to, body, sid };
}

export function mayText(input: { optedIn: boolean; inbound: boolean }): { ok: true } | { ok: false; error: string } {
  if (input.optedIn || input.inbound) return { ok: true };
  return { ok: false, error: "This person has not agreed to texts." };
}

/** Reply goes to whoever sent the last text. A first text goes to the one company that claimed the number. */
export function resolveInboundOrg(input: { claimedOrgId: string | null; claimedAmbiguous: boolean; priorSenderOrgId: string | null }): string | null {
  if (input.priorSenderOrgId) return input.priorSenderOrgId;
  if (input.claimedAmbiguous) return null;
  return input.claimedOrgId;
}

export function publicWebhookUrl(requestUrl: string, appUrl: string | undefined): string {
  if (!appUrl?.trim()) return requestUrl;
  const incoming = new URL(requestUrl);
  return `${appUrl.replace(/\/$/, "")}${incoming.pathname}${incoming.search}`;
}
