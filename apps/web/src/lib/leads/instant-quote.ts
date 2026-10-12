import { isOutsideLeadServiceArea, normalizeLeadZip } from "./lead-zip";

export const INSTANT_QUOTE_DEFAULT_MINIMUM = 50;
export const INSTANT_QUOTE_CONFIRM = "We'll confirm within 24 hours";
export const DEPOSIT_NOT_CONNECTED = "Not connected — add a STRIPE_SECRET_KEY to enable";

export type InstantQuoteStep = "address" | "outside" | "qualify" | "measure" | "contact" | "confirm";

export type InstantQuoteDraft = {
  address: string;
  postalCode: string;
  service: string;
  hasGate: boolean | null;
  hasDogs: boolean | null;
  lotSqft: number | null;
  measurementConfidence: number | null;
  contactName: string;
  phone: string;
  email: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
};

export type InstantQuoteOffer = {
  low: number;
  high: number;
  statedMinimum: number;
  confirm: typeof INSTANT_QUOTE_CONFIRM;
};

export type AbandonedInstantQuote = {
  address: string;
  postalCode: string;
  service: string;
  lotSqft: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
};

export type InstantQuoteConfig = {
  serviceAreaZips: string[];
  statedMinimum: number;
};

export function emptyInstantQuote(
  utm: Pick<InstantQuoteDraft, "utmSource" | "utmMedium" | "utmCampaign" | "utmTerm" | "utmContent"> = {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
  },
): InstantQuoteDraft {
  return {
    address: "",
    postalCode: "",
    service: "",
    hasGate: null,
    hasDogs: null,
    lotSqft: null,
    measurementConfidence: null,
    contactName: "",
    phone: "",
    email: "",
    utmSource: utm.utmSource,
    utmMedium: utm.utmMedium,
    utmCampaign: utm.utmCampaign,
    utmTerm: utm.utmTerm,
    utmContent: utm.utmContent,
  };
}

export function contactCaptured(draft: Pick<InstantQuoteDraft, "contactName" | "phone" | "email">): boolean {
  const name = draft.contactName.trim();
  const phone = draft.phone.trim();
  const email = draft.email.trim();
  return name.length > 0 && (phone.length > 0 || email.includes("@"));
}

/** Customer rectangle: length × width in feet. */
export function lawnSqftFromSides(lengthFt: number, widthFt: number): number | null {
  if (!Number.isFinite(lengthFt) || !Number.isFinite(widthFt)) return null;
  if (lengthFt <= 0 || widthFt <= 0) return null;
  return Math.round(lengthFt * widthFt);
}

export function instantQuoteStep(draft: InstantQuoteDraft, serviceAreaZips: string[]): InstantQuoteStep {
  if (!draft.address.trim() || !normalizeLeadZip(draft.postalCode)) return "address";
  if (isOutsideLeadServiceArea(draft.postalCode, serviceAreaZips)) return "outside";
  if (!draft.service.trim() || draft.hasGate == null || draft.hasDogs == null) return "qualify";
  if (draft.lotSqft == null || !Number.isFinite(draft.lotSqft) || draft.lotSqft <= 0) return "measure";
  if (!contactCaptured(draft)) return "contact";
  return "confirm";
}

export function abandonedInstantQuote(draft: InstantQuoteDraft): AbandonedInstantQuote | null {
  const address = draft.address.trim();
  if (!address) return null;
  if (draft.phone.trim() || draft.email.trim()) return null;
  return {
    address,
    postalCode: normalizeLeadZip(draft.postalCode) ?? draft.postalCode.trim(),
    service: draft.service.trim(),
    lotSqft: draft.lotSqft,
    utmSource: draft.utmSource,
    utmMedium: draft.utmMedium,
    utmCampaign: draft.utmCampaign,
    utmTerm: draft.utmTerm,
    utmContent: draft.utmContent,
  };
}

function settingsNumber(settings: Record<string, unknown>, key: string, fallback: number): number {
  const raw = settings[key];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

export function instantQuoteConfigFromSettings(settings: unknown): InstantQuoteConfig {
  const record =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const rawZips = record.lead_service_area_zips;
  const serviceAreaZips = Array.isArray(rawZips)
    ? rawZips.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return {
    serviceAreaZips,
    statedMinimum: settingsNumber(record, "instant_quote_minimum", INSTANT_QUOTE_DEFAULT_MINIMUM),
  };
}

export function depositLockCopy(stripeConfigured: boolean): string {
  return stripeConfigured ? "Pay a deposit to lock this range." : DEPOSIT_NOT_CONNECTED;
}

function clipUtm(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

/** Lead row written when the range is revealed. The price stays off this row. */
export function instantQuoteLeadRow(orgId: string, draft: InstantQuoteDraft) {
  if (!contactCaptured(draft)) return null;
  const phone = draft.phone.trim();
  const email = draft.email.trim();
  const phoneOk = phone.length >= 3 && phone.length <= 40 ? phone : null;
  const emailOk = email.includes("@") && email.length >= 3 && email.length <= 320 ? email : null;
  if (!phoneOk && !emailOk) return null;
  const name = draft.contactName.trim().slice(0, 200);
  const address = draft.address.trim().slice(0, 500);
  if (!name || !address) return null;
  const note = [
    "Instant quote",
    draft.lotSqft ? `${draft.lotSqft} sq ft` : null,
    draft.hasGate ? "gate" : null,
    draft.hasDogs ? "dogs" : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(". ");
  return {
    org_id: orgId,
    contact_name: name,
    phone: phoneOk,
    email: emailOk,
    address_typed: address,
    postal_code: normalizeLeadZip(draft.postalCode),
    services: draft.service.trim() ? [draft.service.trim().slice(0, 80)] : [],
    note: note.slice(0, 5000),
    source: "Website form" as const,
    needs_address_check: true,
    utm_source: clipUtm(draft.utmSource),
    utm_medium: clipUtm(draft.utmMedium),
    utm_campaign: clipUtm(draft.utmCampaign),
    utm_term: clipUtm(draft.utmTerm),
    utm_content: clipUtm(draft.utmContent),
  };
}
