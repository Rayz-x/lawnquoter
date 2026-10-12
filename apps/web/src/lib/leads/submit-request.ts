import { createHash } from "node:crypto";
import {
  findRepeatFoldLead,
  LEAD_REPEAT_FOLD_WINDOW_MS,
  pickExactPropertyLink,
  rankMatchCandidates,
  type MatchCandidateInput,
  type OpenLeadForFold,
} from "./dedupe";
import {
  validateLeadPhotoCandidates,
  type LeadPhotoFile,
} from "./lead-photos";
import { WEBSITE_FORM_SOURCE } from "./lead-source";
import { isOutsideLeadServiceArea, normalizeLeadZip } from "./lead-zip";
import { normalizeEmail, normalizePhoneE164 } from "./normalize-contact";

export const LEAD_INTAKE_MAX_BODY_BYTES = 32_768;
/** Multipart intake may carry up to 3 × 2 MiB images plus form fields. */
export const LEAD_INTAKE_MAX_MULTIPART_BYTES = 6_500_000;
export const LEAD_INTAKE_MIN_FILL_MS = 3_000;
export const LEAD_INTAKE_IP_LIMIT = 5;
export const LEAD_INTAKE_ORG_LIMIT = 60;
export const LEAD_INTAKE_WINDOW_MS = 60 * 60 * 1000;
/** Esri candidate score normalized to 0–1; below this → needs address check. */
export const LEAD_INTAKE_MIN_GEOCODE_SCORE = 0.8;
/** Rooftop / street-level Esri Addr_type values that pass the N1 gate. */
export const LEAD_INTAKE_ALLOWED_ADDRESS_TYPES = new Set([
  "PointAddress",
  "StreetAddress",
  "Subaddress",
]);
export const LEAD_INTAKE_OUT_OF_AREA_MESSAGE =
  "Thanks — this address may be outside our area. We'll still review your request.";

export type LeadIntakeGeocode = {
  score: number | null;
  addressType: string | null;
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
  name: string;
  /** Org contact email used when no assignee email is available. */
  officeEmail: string | null;
  consentTextVersion: string;
  defaultAssigneeId: string | null;
  serviceAreaZips: string[];
  responseTargetMinutes: number;
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
  needsAddressCheck: boolean;
  outOfArea: boolean;
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
  /** Exact property auto-link only — never auto-merge accounts. */
  accountId: string | null;
  propertyId: string | null;
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
  /** Optional form photos; validated before Turnstile, uploaded only after it passes. */
  photos?: LeadPhotoFile[];
};

export type LeadIntakeDeps = {
  verifyTurnstile: (token: string, ip: string | null) => Promise<boolean>;
  geocode: (address: string) => Promise<LeadIntakeGeocode | null>;
  findOrgBySlug: (slug: string) => Promise<LeadIntakeOrg | null>;
  countRecentByIpHash: (orgId: string, ipHash: string, sinceIso: string) => Promise<number>;
  countRecentByOrg: (orgId: string, sinceIso: string) => Promise<number>;
  insertLead: (row: LeadIntakeInsert) => Promise<{ id: string }>;
  listOpenLeadsForFold: (orgId: string, sinceIso: string) => Promise<OpenLeadForFold[]>;
  listMatchCandidates: (orgId: string, probe: {
    phone: string | null;
    email: string | null;
    addressLine1: string | null;
    postalCode: string | null;
    lat: number | null;
    lng: number | null;
  }) => Promise<MatchCandidateInput[]>;
  foldIntoLead: (args: {
    leadId: string;
    orgId: string;
    note: string | null;
    services: string[];
    addressTyped: string;
  }) => Promise<{ id: string }>;
  uploadLeadPhotos: (args: {
    orgId: string;
    leadId: string;
    photos: LeadPhotoFile[];
  }) => Promise<string[]>;
  /** L08: email assignee/office + requester confirmation after a successful store. */
  notifyNewLead?: (input: {
    status: "new" | "spam";
    leadId: string;
    row: LeadIntakeInsert;
    org: LeadIntakeOrg;
  }) => Promise<void>;
  nowMs: () => number;
};

export type LeadIntakeResult =
  | { ok: true; status: "new" | "spam"; message?: string }
  | { ok: false; reason: "validation" | "turnstile" | "rate_limit" | "not_found" | "store" };

export { isOutsideLeadServiceArea, normalizeLeadZip };

export function passesLeadGeocodeGate(geocode: LeadIntakeGeocode | null): boolean {
  if (!geocode) return false;
  if (geocode.score == null || geocode.score < LEAD_INTAKE_MIN_GEOCODE_SCORE) return false;
  const type = geocode.addressType?.trim();
  if (!type || !LEAD_INTAKE_ALLOWED_ADDRESS_TYPES.has(type)) return false;
  return true;
}

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
  const phone = normalizePhoneE164(input.phone);
  const email = normalizeEmail(input.email);

  if (!slug || !contactName || !addressTyped || (!phone && !email)) {
    return { ok: false, reason: "validation" };
  }

  const photos = input.photos ?? [];
  const photoCheck = validateLeadPhotoCandidates(photos);
  if (!photoCheck.ok) {
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

  const gatePassed = status === "new" && passesLeadGeocodeGate(geocode);
  const needsAddressCheck = status === "new" && !gatePassed;
  const zipForArea =
    normalizeLeadZip(geocode?.postalCode) ?? normalizeLeadZip(addressTyped);
  const outOfArea =
    status === "new" && isOutsideLeadServiceArea(zipForArea, org.serviceAreaZips ?? []);

  const services = normalizeServices(input.services ?? []);
  const note = clip(input.note, 5000);

  // Append-only fold (#176): never overwrite open-lead address/geocode from intake.
  if (status === "new") {
    const foldSinceIso = new Date(now - LEAD_REPEAT_FOLD_WINDOW_MS).toISOString();
    const openLeads = await deps.listOpenLeadsForFold(org.orgId, foldSinceIso);
    const fold = findRepeatFoldLead({ phone, email }, openLeads, { nowMs: now });
    if (fold) {
      try {
        await deps.foldIntoLead({
          leadId: fold.id,
          orgId: org.orgId,
          note,
          services,
          addressTyped,
        });
        if (photos.length > 0) {
          await deps.uploadLeadPhotos({
            orgId: org.orgId,
            leadId: fold.id,
            photos,
          });
        }
      } catch {
        return { ok: false, reason: "store" };
      }
      if (outOfArea) {
        return { ok: true, status: "new", message: LEAD_INTAKE_OUT_OF_AREA_MESSAGE };
      }
      return { ok: true, status: "new" };
    }
  }

  let accountId: string | null = null;
  let propertyId: string | null = null;
  if (status === "new") {
    const structuredLine1 = gatePassed ? (geocode?.line1 ?? null) : null;
    const structuredCity = gatePassed ? (geocode?.city ?? null) : null;
    const structuredPostal = gatePassed ? (geocode?.postalCode ?? null) : null;
    const structuredLat = gatePassed ? (geocode?.lat ?? null) : null;
    const structuredLng = gatePassed ? (geocode?.lng ?? null) : null;
    const candidates = await deps.listMatchCandidates(org.orgId, {
      phone,
      email,
      addressLine1: structuredLine1,
      postalCode: structuredPostal,
      lat: structuredLat,
      lng: structuredLng,
    });
    const ranked = rankMatchCandidates(
      {
        phone,
        email,
        addressTyped,
        addressLine1: structuredLine1,
        city: structuredCity,
        postalCode: structuredPostal,
        lat: structuredLat,
        lng: structuredLng,
      },
      candidates,
    );
    const exact = pickExactPropertyLink(ranked);
    if (exact?.propertyId) {
      accountId = exact.accountId;
      propertyId = exact.propertyId;
    }
  }

  const preferred =
    input.preferredContact === "phone" ||
    input.preferredContact === "email" ||
    input.preferredContact === "either"
      ? input.preferredContact
      : null;

  // Typed address always kept; structured fields only when the score/type gate passes.
  const row: LeadIntakeInsert = {
    orgId: org.orgId,
    status,
    contactName,
    phone,
    email,
    preferredContact: preferred,
    isBusiness: Boolean(input.isBusiness),
    addressTyped,
    addressLine1: gatePassed ? (geocode?.line1 ?? null) : null,
    city: gatePassed ? (geocode?.city ?? null) : null,
    region: gatePassed ? (geocode?.region ?? null) : null,
    postalCode: gatePassed ? (geocode?.postalCode ?? null) : null,
    country: gatePassed ? (geocode?.country ?? "US") : "US",
    geocodeScore: geocode?.score ?? null,
    geocodeAttribution: geocode?.attribution ?? null,
    geocodeRaw: geocode?.raw ?? null,
    needsAddressCheck,
    outOfArea,
    services,
    note,
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
    accountId,
    propertyId,
  };

  let leadId: string;
  try {
    const inserted = await deps.insertLead(row);
    leadId = inserted.id;
    if (photos.length > 0) {
      await deps.uploadLeadPhotos({
        orgId: org.orgId,
        leadId: inserted.id,
        photos,
      });
    }
  } catch {
    return { ok: false, reason: "store" };
  }

  if (deps.notifyNewLead) {
    try {
      await deps.notifyNewLead({ status, leadId, row, org });
    } catch {
      // Store already succeeded; do not fail the public response on mail errors.
      console.error("new-lead notify failed");
    }
  }

  if (outOfArea) {
    return { ok: true, status, message: LEAD_INTAKE_OUT_OF_AREA_MESSAGE };
  }
  return { ok: true, status };
}
