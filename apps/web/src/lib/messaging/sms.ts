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
  const from = toE164(input.from ?? "");
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

export const SMS_NUMBER_NOT_ASSIGNED = "That number is not assigned to this company.";
export const SMS_NUMBER_UNCONFIRMED = "Twilio could not confirm that number.";

/**
 * The Twilio account is shared by every company. Presence on that account is not ownership.
 * A number is this company's only when Twilio lists it and its name is the company id.
 */
export async function smsNumberAssignedToOrg(input: {
  config: TwilioConfig | null;
  orgId: string;
  smsNumber: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<{ ok: true; smsNumber: string } | { ok: false; error: string }> {
  if (!input.config) return { ok: false, error: TWILIO_NOT_CONNECTED };
  const smsNumber = toE164(input.smsNumber);
  const orgId = input.orgId.trim();
  if (!smsNumber || !orgId) return { ok: false, error: SMS_NUMBER_NOT_ASSIGNED };
  const response = await input.fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${input.config.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(smsNumber)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.config.accountSid}:${input.config.authToken}`).toString("base64")}`,
      },
    },
  );
  if (!response.ok) return { ok: false, error: SMS_NUMBER_UNCONFIRMED };
  const payload = (await response.json()) as { incoming_phone_numbers?: { phone_number?: string; friendly_name?: string }[] };
  const match = (payload.incoming_phone_numbers ?? []).find((row) => toE164(row.phone_number ?? "") === smsNumber);
  if (!match || match.friendly_name?.trim() !== orgId) return { ok: false, error: SMS_NUMBER_NOT_ASSIGNED };
  return { ok: true, smsNumber };
}

/** The company's own texting number. The shared Twilio sender is not a tenant From. */
export function claimedSmsFrom(smsNumber: string | null | undefined): string | null {
  if (!smsNumber?.trim()) return null;
  return toE164(smsNumber);
}

/** An inbound text belongs only to the company that claimed that number. */
export function resolveInboundOrg(input: { claimedOrgId: string | null; claimedAmbiguous: boolean }): string | null {
  if (input.claimedAmbiguous || !input.claimedOrgId) return null;
  return input.claimedOrgId;
}

export function publicWebhookUrl(requestUrl: string, appUrl: string | undefined): string {
  if (!appUrl?.trim()) return requestUrl;
  const incoming = new URL(requestUrl);
  return `${appUrl.replace(/\/$/, "")}${incoming.pathname}${incoming.search}`;
}
