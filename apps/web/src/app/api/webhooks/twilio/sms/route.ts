import { inboundSms, publicWebhookUrl, readTwilioConfig, resolveInboundOrg, toE164 } from "@/lib/messaging/sms";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function formParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;
  return params;
}

export async function POST(request: Request): Promise<Response> {
  const config = readTwilioConfig(process.env);
  const decision = inboundSms({
    config,
    url: publicWebhookUrl(request.url, process.env.NEXT_PUBLIC_APP_URL),
    params: formParams(await request.formData()),
    signature: request.headers.get("x-twilio-signature"),
  });
  if (!decision.ok) return Response.json({ error: decision.error }, { status: decision.status });

  const admin = createAdminClient();
  const [{ data: claimed, error: claimError }, { data: prior, error: priorError }] = await Promise.all([
    admin.from("orgs").select("id").eq("sms_number", decision.to).maybeSingle(),
    admin.from("messages").select("org_id").eq("channel", "sms").eq("direction", "out").eq("from_address", decision.to).eq("to_address", decision.from).order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (priorError) return Response.json({ error: priorError.message }, { status: 500 });
  const orgId = resolveInboundOrg({
    claimedOrgId: claimed?.id ?? null,
    claimedAmbiguous: Boolean(claimError),
    priorSenderOrgId: prior?.org_id ?? null,
  });
  if (!orgId) return Response.json({ error: "unknown_number" }, { status: 404 });

  const { data: contacts } = await admin.from("contacts").select("id, account_id, phone").eq("org_id", orgId).not("phone", "is", null);
  const contact = (contacts ?? []).find((row) => toE164(row.phone ?? "") === decision.from) ?? null;
  const { data: activity, error: activityError } = await admin.from("activities").insert({
    org_id: orgId,
    account_id: contact?.account_id ?? null,
    kind: "sms.in",
    summary: `Text from ${decision.from}`,
    meta: { provider_id: decision.sid },
  }).select("id").single();
  if (activityError) return Response.json({ error: activityError.message }, { status: 500 });

  const { error } = await admin.from("messages").insert({
    org_id: orgId,
    channel: "sms",
    direction: "in",
    status: "received",
    from_address: decision.from,
    to_address: decision.to,
    body: decision.body,
    provider: "twilio",
    provider_id: decision.sid,
    account_id: contact?.account_id ?? null,
    contact_id: contact?.id ?? null,
    activity_id: activity.id,
  });
  if (error?.code === "23505") return Response.json({ ok: true, duplicate: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
