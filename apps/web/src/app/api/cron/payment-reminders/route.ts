import { createEmailProvider } from "@/lib/email/provider";
import { runPaymentRemindersJob } from "@/lib/billing/run-payment-reminders";
import { createSupabasePaymentRemindersStore } from "@/lib/billing/supabase-payment-reminders-store";

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
    const result = await runPaymentRemindersJob({
      store: createSupabasePaymentRemindersStore(),
      send: (message) => provider.send(message),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "payment reminders failed";
    console.error(message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
