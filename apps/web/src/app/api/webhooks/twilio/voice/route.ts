import { twilioRecording } from "@/lib/messaging/calls";
import { recordTrackedCall } from "@/lib/messaging/record-call";
import { publicWebhookUrl, readTwilioConfig } from "@/lib/messaging/sms";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const config = readTwilioConfig(process.env);
  const params = Object.fromEntries(new URLSearchParams(await request.text())) as Record<string, string>;
  const result = twilioRecording({
    config,
    url: publicWebhookUrl(request.url, process.env.NEXT_PUBLIC_APP_URL),
    params,
    signature: request.headers.get("x-twilio-signature"),
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  const stored = await recordTrackedCall(createAdminClient(), result, "twilio");
  if (!stored.ok) return Response.json({ error: stored.error }, { status: stored.status });
  return Response.json({ ok: true, duplicate: stored.duplicate ?? false });
}
