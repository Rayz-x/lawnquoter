import { NextResponse } from "next/server";
import { facebookSignatureMatches, inboundLeadRow, parseInboundLead } from "@/lib/leads/inbound";
import { loadPublicLeadForm } from "@/lib/leads/load-public-form";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function notConnected(envName: string) {
  return NextResponse.json({ error: `Not connected — add ${envName} to enable` }, { status: 503 });
}

export async function GET(request: Request) {
  const token = process.env.FACEBOOK_LEAD_ADS_VERIFY_TOKEN?.trim();
  if (!token) return notConnected("FACEBOOK_LEAD_ADS_VERIFY_TOKEN");
  const url = new URL(request.url);
  if (url.searchParams.get("hub.mode") !== "subscribe" || url.searchParams.get("hub.verify_token") !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
}

type LeadgenBody = {
  entry?: { changes?: { field?: string; value?: { leadgen_id?: string } }[] }[];
};

export async function POST(request: Request) {
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!appSecret) return notConnected("FACEBOOK_APP_SECRET");
  const raw = await request.text();
  if (!facebookSignatureMatches(appSecret, raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  if (!pageToken) return notConnected("FACEBOOK_PAGE_ACCESS_TOKEN");
  const slug = process.env.INBOUND_LEAD_ORG_SLUG?.trim();
  if (!slug) return notConnected("INBOUND_LEAD_ORG_SLUG");

  let body: LeadgenBody;
  try {
    body = JSON.parse(raw) as LeadgenBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const leadgenId = body.entry?.[0]?.changes?.find((change) => change.field === "leadgen")?.value?.leadgen_id;
  if (!leadgenId) return NextResponse.json({ ok: true, stored: false });

  const graph = await fetch(
    `https://graph.facebook.com/v20.0/${encodeURIComponent(leadgenId)}?fields=field_data&access_token=${encodeURIComponent(pageToken)}`,
  );
  if (!graph.ok) return NextResponse.json({ error: "Could not read the Facebook lead." }, { status: 502 });
  const payload = (await graph.json()) as { field_data?: { name: string; values?: string[] }[] };
  const bag: Record<string, unknown> = {};
  for (const field of payload.field_data ?? []) bag[field.name] = field.values?.[0] ?? "";
  const lead = parseInboundLead({
    contactName: bag.full_name,
    phone: bag.phone_number,
    email: bag.email,
    address: bag.street_address,
  });
  if (!lead) return NextResponse.json({ error: "Name and phone or email are required." }, { status: 400 });
  const org = await loadPublicLeadForm(slug);
  if (!org) return NextResponse.json({ error: "Unknown company." }, { status: 404 });
  const { error } = await createAdminClient().from("lead_requests").insert(inboundLeadRow(org.orgId, "Facebook", lead));
  if (error) return NextResponse.json({ error: "Could not save the lead." }, { status: 500 });
  return NextResponse.json({ ok: true, stored: true });
}
