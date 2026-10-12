import { NextResponse } from "next/server";
import { bearerConnector, inboundAuthDecision, inboundLeadRow, parseInboundLead } from "@/lib/leads/inbound";
import { loadPublicLeadForm } from "@/lib/leads/load-public-form";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Generic inbound lead webhook used by Zapier, Google LSA, Thumbtack, Yelp, and Angi. */
export async function POST(request: Request, context: { params: Promise<{ connector: string }> }) {
  const { connector: id } = await context.params;
  const connector = bearerConnector(id);
  if (!connector) return NextResponse.json({ error: "Unknown connector." }, { status: 404 });

  const decision = inboundAuthDecision(process.env[connector.env], request.headers.get("authorization"), connector.env);
  if (!decision.ok) return NextResponse.json({ error: decision.message }, { status: decision.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const slug = typeof record.slug === "string" ? record.slug : "";
  const lead = parseInboundLead(record);
  if (!lead) return NextResponse.json({ error: "Name and phone or email are required." }, { status: 400 });

  const org = await loadPublicLeadForm(slug);
  if (!org) return NextResponse.json({ error: "Unknown company." }, { status: 404 });
  const { error } = await createAdminClient().from("lead_requests").insert(inboundLeadRow(org.orgId, connector.source, lead));
  if (error) return NextResponse.json({ error: "Could not save the lead." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
