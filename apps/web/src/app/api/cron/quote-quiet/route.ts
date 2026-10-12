import { isGoneQuiet } from "@/lib/quotes/gone-quiet";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const now = Date.now();
  const { data: quotes } = await admin.from("quotes").select("id, account_id, status, sent_at, viewed_at, gone_quiet_at").eq("status", "sent").not("sent_at", "is", null);
  const accountIds = [...new Set((quotes ?? []).map((quote) => quote.account_id))];
  const { data: replies } = accountIds.length
    ? await admin.from("messages").select("account_id, occurred_at").eq("direction", "in").in("account_id", accountIds)
    : { data: [] };
  let flagged = 0;
  let cleared = 0;
  for (const quote of quotes ?? []) {
    const replied = (replies ?? []).some((message) => message.account_id === quote.account_id && quote.sent_at && message.occurred_at >= quote.sent_at);
    const quiet = isGoneQuiet({ status: quote.status, sentAt: quote.sent_at, viewedAt: quote.viewed_at, replied, asOfMs: now });
    if (quiet && !quote.gone_quiet_at) {
      await admin.from("quotes").update({ gone_quiet_at: new Date(now).toISOString() }).eq("id", quote.id);
      flagged += 1;
    }
    if (!quiet && quote.gone_quiet_at) {
      await admin.from("quotes").update({ gone_quiet_at: null }).eq("id", quote.id);
      cleared += 1;
    }
  }
  const { data: stale } = await admin.from("quotes").select("id").not("gone_quiet_at", "is", null).neq("status", "sent");
  for (const quote of stale ?? []) {
    await admin.from("quotes").update({ gone_quiet_at: null }).eq("id", quote.id);
    cleared += 1;
  }
  return Response.json({ ok: true, flagged, cleared });
}
