import { NextResponse } from "next/server";
import { abandonedInstantQuote, type InstantQuoteDraft } from "@/lib/leads/instant-quote";
import { loadInstantQuotePage } from "@/lib/leads/load-public-form";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function text(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === "string" ? row[key] : "";
}

function nullable(row: Record<string, unknown>, key: string): string | null {
  return typeof row[key] === "string" && row[key].trim() ? row[key].trim() : null;
}

function asDraft(value: unknown): InstantQuoteDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    address: text(row, "address"),
    postalCode: text(row, "postalCode"),
    service: text(row, "service"),
    hasGate: row.hasGate === true ? true : row.hasGate === false ? false : null,
    hasDogs: row.hasDogs === true ? true : row.hasDogs === false ? false : null,
    lotSqft: typeof row.lotSqft === "number" ? row.lotSqft : null,
    measurementConfidence: typeof row.measurementConfidence === "number" ? row.measurementConfidence : null,
    contactName: text(row, "contactName"),
    phone: text(row, "phone"),
    email: text(row, "email"),
    utmSource: nullable(row, "utmSource"),
    utmMedium: nullable(row, "utmMedium"),
    utmCampaign: nullable(row, "utmCampaign"),
    utmTerm: nullable(row, "utmTerm"),
    utmContent: nullable(row, "utmContent"),
  };
}

/** Record a visitor who entered an address and left without a phone or email. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as { slug?: unknown; draft?: unknown }) : {};
  const slug = typeof record.slug === "string" ? record.slug : "";
  const draft = asDraft(record.draft);
  if (!draft) return NextResponse.json({ ok: false }, { status: 400 });
  const event = abandonedInstantQuote(draft);
  if (!event) return NextResponse.json({ ok: true, stored: false });

  const org = await loadInstantQuotePage(slug);
  if (!org) return NextResponse.json({ ok: false }, { status: 404 });
  const { error } = await createAdminClient().from("instant_quote_events").insert({
    org_id: org.orgId,
    kind: "abandoned",
    address: event.address,
    postal_code: event.postalCode || null,
    service: event.service || null,
    lot_sqft: event.lotSqft,
    utm_source: event.utmSource,
    utm_medium: event.utmMedium,
    utm_campaign: event.utmCampaign,
    utm_term: event.utmTerm,
    utm_content: event.utmContent,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true, stored: true });
}
