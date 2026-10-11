import { createHash } from "node:crypto";
import { WEBSITE_FORM_SOURCE } from "./lead-source";

export const LEAD_INTAKE_MAX_BODY_BYTES = 32_768;
export const LEAD_INTAKE_MIN_FILL_MS = 3_000;
export const LEAD_INTAKE_IP_LIMIT = 5;
export const LEAD_INTAKE_ORG_LIMIT = 60;
export const LEAD_INTAKE_WINDOW_MS = 60 * 60 * 1000;

export type LeadIntakeGeocode = {
  score: number | null;
  line1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  lng: number | null;
  lat: number | null;
  attribution: string | null;
  raw: Record<string, unknown> | null;
};

export type LeadIntakeOrg = {
  orgId: string;
  consentTextVersion: string;
  defaultAssigneeId: string | null;
};

export type LeadIntakeInsert = {
  orgId: string;
  status: "new" | "spam";
  contactName: string;
  phone: string | null;
  email: string | null;
  preferredContact: "phone" | "email" | "either" | null;
  isBusiness: boolean;
  addressTyped: string;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  geocodeScore: number | null;
  geocodeAttribution: string | null;
  geocodeRaw: Record<string, unknown> | null;
  services: string[];
  note: string | null;
  source: string;
  sourceOther: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  landingPage: string | null;
  smsConsent: boolean;
  consentTextVersion: string;
  consentAt: string;
  consentIpHash: string;
  consentUa: string | null;
  spamScore: number;
  ipHash: string;
  assigneeId: string | null;
};

export type LeadIntakeInput = {
  slug: string;
  contactName: string;
  addressTyped: string;
  phone: string | null;
  email: string | null;
  turnstileToken: string;
  honeypot: string;
  formStartedAtMs: number | null;
  smsConsent: boolean;
  services: string[];
  note: string | null;
  isBusiness: boolean;
  preferredContact: "phone" | "email" | "either" | null;
  heardAbout: string | null;
  heardAboutOther: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  landingPage: string | null;
  clientIp: string | null;
  userAgent: string | null;
};

export type LeadIntakeDeps = {
  verifyTurnstile: (token: string, ip: string | null) => Promise<boolean>;
  geocode: (address: string) => Promise<LeadIntakeGeocode | null>;
  findOrgBySlug: (slug: string) => Promise<LeadIntakeOrg | null>;
  countRecentByIpHash: (orgId: string, ipHash: string, sinceIso: string) => Promise<number>;
  countRecentByOrg: (orgId: string, sinceIso: string) => Promise<number>;
  insertLead: (row: LeadIntakeInsert) => Promise<{ id: string }>;
  nowMs: () => number;
};

export type LeadIntakeResult =
  | { ok: true; status: "new" | "spam" }
  | { ok: false; reason: "validation" | "turnstile" | "rate_limit" | "not_found" | "store" };

export function hashClientIp(ip: string | null): string {
  const material = ip?.trim() || "unknown";
  return createHash("sha256").update(material).digest("hex");
}

function clip(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normalizeEmail(raw: string | null): string | null {
  const email = clip(raw, 320);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email.toLowerCase();
}

function normalizePhone(raw: string | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return clip(trimmed, 40);
}

function normalizeServices(services: string[]): string[] {
  const out: string[] = [];
  for (const item of services) {
    const s = clip(item, 80);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 32) break;
  }
  return out;
}

export async function submitPublicLeadRequest(
  input: LeadIntakeInput,
  deps: LeadIntakeDeps,
): Promise<LeadIntakeResult> {
  const slug = clip(input.slug, 80);
  const contactName = clip(input.contactName, 200);
  const addressTyped = clip(input.addressTyped, 500);
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);

  if (!slug || !contactName || !addressTyped || (!phone && !email)) {
    return { ok: false, reason: "validation" };
  }
  if (!clip(input.turnstileToken, 2048)) {
    return { ok: false, reason: "turnstile" };
  }

  const org = await deps.findOrgBySlug(slug);
  if (!org) return { ok: false, reason: "not_found" };

  const turnstileOk = await deps.verifyTurnstile(input.turnstileToken.trim(), input.clientIp);
  if (!turnstileOk) return { ok: false, reason: "turnstile" };

  const now = deps.nowMs();
  const sinceIso = new Date(now - LEAD_INTAKE_WINDOW_MS).toISOString();
  const ipHash = hashClientIp(input.clientIp);

  const [ipCount, orgCount] = await Promise.all([
    deps.countRecentByIpHash(org.orgId, ipHash, sinceIso),
    deps.countRecentByOrg(org.orgId, sinceIso),
  ]);
  if (ipCount >= LEAD_INTAKE_IP_LIMIT || orgCount >= LEAD_INTAKE_ORG_LIMIT) {
    return { ok: false, reason: "rate_limit" };
  }

  const honeypotFilled = Boolean(input.honeypot?.trim());
  const fillMs =
    input.formStartedAtMs != null && Number.isFinite(input.formStartedAtMs)
      ? now - input.formStartedAtMs
      : null;
  const tooFast = fillMs == null || fillMs < LEAD_INTAKE_MIN_FILL_MS;

  let spamScore = 0;
  if (honeypotFilled) spamScore += 5;
  if (tooFast) spamScore += 2;
  const status: "new" | "spam" = spamScore > 0 ? "spam" : "new";

  let geocode: LeadIntakeGeocode | null = null;
  if (status === "new") {
    geocode = await deps.geocode(addressTyped);
  }

  const preferred =
    input.preferredContact === "phone" ||
    input.preferredContact === "email" ||
    input.preferredContact === "either"
      ? input.preferredContact
      : null;

  try {
    await deps.insertLead({
      orgId: org.orgId,
      status,
      contactName,
      phone,
      email,
      preferredContact: preferred,
      isBusiness: Boolean(input.isBusiness),
      addressTyped,
      addressLine1: geocode?.line1 ?? null,
      city: geocode?.city ?? null,
      region: geocode?.region ?? null,
      postalCode: geocode?.postalCode ?? null,
      country: geocode?.country ?? "US",
      geocodeScore: geocode?.score ?? null,
      geocodeAttribution: geocode?.attribution ?? null,
      geocodeRaw: geocode?.raw ?? null,
      services: normalizeServices(input.services ?? []),
      note: clip(input.note, 5000),
      source: WEBSITE_FORM_SOURCE,
      sourceOther: clip(input.heardAboutOther ?? input.heardAbout, 100),
      utmSource: clip(input.utmSource, 200),
      utmMedium: clip(input.utmMedium, 200),
      utmCampaign: clip(input.utmCampaign, 200),
      utmTerm: clip(input.utmTerm, 200),
      utmContent: clip(input.utmContent, 200),
      referrer: clip(input.referrer, 2000),
      landingPage: clip(input.landingPage, 2000),
      smsConsent: Boolean(input.smsConsent),
      consentTextVersion: org.consentTextVersion,
      consentAt: new Date(now).toISOString(),
      consentIpHash: ipHash,
      consentUa: clip(input.userAgent, 500),
      spamScore,
      ipHash,
      assigneeId: status === "new" ? org.defaultAssigneeId : null,
    });
  } catch {
    return { ok: false, reason: "store" };
  }

  return { ok: true, status };
}
