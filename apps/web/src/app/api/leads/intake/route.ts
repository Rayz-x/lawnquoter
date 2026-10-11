import { NextResponse } from "next/server";
import { geocodeForLeadIntake } from "@/lib/leads/intake-geocode";
import { createLeadIntakeStore } from "@/lib/leads/intake-store";
import {
  LEAD_INTAKE_MAX_BODY_BYTES,
  submitPublicLeadRequest,
  type LeadIntakeInput,
} from "@/lib/leads/submit-request";
import { verifyTurnstileToken } from "@/lib/leads/turnstile";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const GENERIC_OK = { ok: true as const };
const GENERIC_FAIL = { ok: false as const };

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

function asString(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function asServices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 32);
}

function asPreferred(value: unknown): LeadIntakeInput["preferredContact"] {
  if (value === "phone" || value === "email" || value === "either") return value;
  return null;
}

function parseBody(json: unknown): Omit<LeadIntakeInput, "clientIp" | "userAgent"> | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const formStartedRaw = body.formStartedAtMs ?? body.form_started_at_ms;
  const formStartedAtMs =
    typeof formStartedRaw === "number" && Number.isFinite(formStartedRaw)
      ? formStartedRaw
      : typeof formStartedRaw === "string" && formStartedRaw.trim()
        ? Number(formStartedRaw)
        : null;

  return {
    slug: asString(body.slug, 80) ?? "",
    contactName: asString(body.contactName ?? body.contact_name, 200) ?? "",
    addressTyped: asString(body.addressTyped ?? body.address_typed ?? body.address, 500) ?? "",
    phone: asString(body.phone, 40),
    email: asString(body.email, 320),
    turnstileToken: asString(body.turnstileToken ?? body.turnstile_token ?? body["cf-turnstile-response"], 2048) ?? "",
    honeypot: asString(body.website ?? body.honeypot, 500) ?? "",
    formStartedAtMs: formStartedAtMs != null && Number.isFinite(formStartedAtMs) ? formStartedAtMs : null,
    smsConsent: asBoolean(body.smsConsent ?? body.sms_consent),
    services: asServices(body.services),
    note: asString(body.note, 5000),
    isBusiness: asBoolean(body.isBusiness ?? body.is_business),
    preferredContact: asPreferred(body.preferredContact ?? body.preferred_contact),
    heardAbout: asString(body.heardAbout ?? body.heard_about, 100),
    heardAboutOther: asString(body.heardAboutOther ?? body.heard_about_other, 100),
    utmSource: asString(body.utmSource ?? body.utm_source, 200),
    utmMedium: asString(body.utmMedium ?? body.utm_medium, 200),
    utmCampaign: asString(body.utmCampaign ?? body.utm_campaign, 200),
    utmTerm: asString(body.utmTerm ?? body.utm_term, 200),
    utmContent: asString(body.utmContent ?? body.utm_content, 200),
    referrer: asString(body.referrer, 2000),
    landingPage: asString(body.landingPage ?? body.landing_page, 2000),
  };
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > LEAD_INTAKE_MAX_BODY_BYTES) {
    return NextResponse.json(GENERIC_FAIL, { status: 413 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json(GENERIC_FAIL, { status: 400 });
  }
  if (raw.length > LEAD_INTAKE_MAX_BODY_BYTES) {
    return NextResponse.json(GENERIC_FAIL, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json(GENERIC_FAIL, { status: 400 });
  }

  const parsed = parseBody(json);
  if (!parsed) return NextResponse.json(GENERIC_FAIL, { status: 400 });

  const store = createLeadIntakeStore(createAdminClient());
  const result = await submitPublicLeadRequest(
    {
      ...parsed,
      clientIp: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    },
    {
      verifyTurnstile: verifyTurnstileToken,
      geocode: geocodeForLeadIntake,
      findOrgBySlug: store.findOrgBySlug,
      countRecentByIpHash: store.countRecentByIpHash,
      countRecentByOrg: store.countRecentByOrg,
      insertLead: store.insertLead,
      listOpenLeadsForFold: store.listOpenLeadsForFold,
      listMatchCandidates: store.listMatchCandidates,
      foldIntoLead: store.foldIntoLead,
      nowMs: () => Date.now(),
    },
  );

  if (!result.ok) {
    const status =
      result.reason === "rate_limit" ? 429 : result.reason === "not_found" ? 404 : 400;
    return NextResponse.json(GENERIC_FAIL, { status });
  }

  // Same success shape whether spam quarantine or new — no existence leak.
  // Optional polite message (e.g. out-of-area) is safe to surface on success.
  if (result.message) {
    return NextResponse.json({ ...GENERIC_OK, message: result.message }, { status: 200 });
  }
  return NextResponse.json(GENERIC_OK, { status: 200 });
}
