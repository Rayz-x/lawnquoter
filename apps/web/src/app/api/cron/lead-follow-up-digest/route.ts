import { createEmailProvider } from "@/lib/email/provider";
import { runFollowUpDigestJob } from "@/lib/leads/run-follow-up-digest";
import { createSupabaseFollowUpDigestStore } from "@/lib/leads/supabase-follow-up-digest-store";

export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

/** Hourly Vercel cron; sends only when an org's local clock is in the 7 AM hour. */
export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const provider = createEmailProvider();
    const result = await runFollowUpDigestJob({
      store: createSupabaseFollowUpDigestStore(),
      send: (message) => provider.send(message),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "digest failed";
    console.error(message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
