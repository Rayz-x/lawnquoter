import { callrailCall, readCallrailSecret } from "@/lib/messaging/calls";
import { recordTrackedCall } from "@/lib/messaging/record-call";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const secret = readCallrailSecret(process.env);
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const result = callrailCall({ secret, provided: request.headers.get("x-callrail-signature"), payload: payload ?? {} });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  const stored = await recordTrackedCall(createAdminClient(), result, "callrail");
  if (!stored.ok) return Response.json({ error: stored.error }, { status: stored.status });
  return Response.json({ ok: true, duplicate: stored.duplicate ?? false });
}
