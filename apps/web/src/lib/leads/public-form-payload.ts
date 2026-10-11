/** Pure helpers for the hosted request-a-quote form (L05). */

export const DEFAULT_LEAD_FORM_SERVICES = [
  "Mowing",
  "Fertilization",
  "Leaf cleanup",
  "Other",
] as const;

export type HostedQuoteFormState = {
  slug: string;
  contactName: string;
  addressTyped: string;
  phone: string;
  email: string;
  services: string[];
  note: string;
  preferredContact: "phone" | "email" | "either" | "";
  isBusiness: boolean;
  smsConsent: boolean;
  heardAbout: string;
  heardAboutOther: string;
  turnstileToken: string;
  honeypot: string;
  formStartedAtMs: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  landingPage: string | null;
};

/** Body for POST /api/leads/intake — the only submit path for the hosted form. */
export function buildHostedIntakeBody(state: HostedQuoteFormState): Record<string, unknown> {
  return {
    slug: state.slug,
    contactName: state.contactName.trim(),
    addressTyped: state.addressTyped.trim(),
    phone: state.phone.trim() || null,
    email: state.email.trim() || null,
    services: state.services,
    note: state.note.trim() || null,
    preferredContact: state.preferredContact || null,
    isBusiness: state.isBusiness,
    smsConsent: state.smsConsent,
    heardAbout: state.heardAbout.trim() || null,
    heardAboutOther: state.heardAboutOther.trim() || null,
    turnstileToken: state.turnstileToken,
    website: state.honeypot,
    formStartedAtMs: state.formStartedAtMs,
    utmSource: state.utmSource,
    utmMedium: state.utmMedium,
    utmCampaign: state.utmCampaign,
    utmTerm: state.utmTerm,
    utmContent: state.utmContent,
    referrer: state.referrer,
    landingPage: state.landingPage,
  };
}

export function formatExpectedReply(minutes: number): string {
  const m = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 60;
  if (m < 60) return `We usually reply within ${m} minutes.`;
  const hours = Math.round(m / 60);
  return hours === 1 ? "We usually reply within 1 hour." : `We usually reply within ${hours} hours.`;
}

export async function submitHostedQuoteRequest(
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean }> {
  const res = await fetchImpl("/api/leads/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false };
  try {
    const json = (await res.json()) as { ok?: boolean };
    return { ok: json.ok === true };
  } catch {
    return { ok: false };
  }
}

export function utmFromSearchParams(params: URLSearchParams): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
} {
  const pick = (key: string) => {
    const v = params.get(key)?.trim();
    return v || null;
  };
  return {
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign: pick("utm_campaign"),
    utmTerm: pick("utm_term"),
    utmContent: pick("utm_content"),
  };
}
