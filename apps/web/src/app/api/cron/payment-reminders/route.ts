import { createEmailProvider } from "@/lib/email/provider";
import { runPaymentRemindersJob } from "@/lib/billing/run-payment-reminders";
import { createSupabasePaymentRemindersStore } from "@/lib/billing/supabase-payment-reminders-store";
import { claimedSmsFrom, deliverSms, readTwilioConfig } from "@/lib/messaging/sms";
import { createAdminClient } from "@/lib/supabase/server";

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
    const config = readTwilioConfig(process.env);
    const admin = createAdminClient();
    const result = await runPaymentRemindersJob({
      store: createSupabasePaymentRemindersStore(),
      send: (message) => provider.send(message),
      onEmailSent: async (invoice, to) => {
        const from = process.env.EMAIL_FROM?.trim() || "email";
        const { data: activity } = await admin.from("activities").insert({
          org_id: invoice.orgId,
          account_id: invoice.accountId,
          kind: "email.out",
          summary: `Email to ${to}`,
          meta: { invoice_id: invoice.id },
        }).select("id").single();
        await admin.from("messages").insert({
          org_id: invoice.orgId,
          channel: "email",
          direction: "out",
          status: "sent",
          from_address: from,
          to_address: to,
          body: `Payment reminder for ${invoice.numberLabel ?? "invoice"}`,
          provider: "resend",
          account_id: invoice.accountId,
          invoice_id: invoice.id,
          activity_id: activity?.id ?? null,
        });
      },
      sendText: config
        ? async (message) => {
            const from = claimedSmsFrom(message.from);
            if (!from) return { sent: false };
            const delivery = await deliverSms({
              config,
              to: message.to,
              from,
              body: message.body,
              fetch: (url, init) => fetch(url, init),
            });
            const { data: activity } = await admin.from("activities").insert({
              org_id: message.orgId,
              account_id: message.accountId,
              kind: "sms.out",
              summary: delivery.sent ? `Text to ${message.to}` : `Text to ${message.to} failed`,
              meta: { to: message.to, invoice_id: message.invoiceId },
            }).select("id").single();
            await admin.from("messages").insert({
              org_id: message.orgId,
              channel: "sms",
              direction: "out",
              status: delivery.sent ? "sent" : "failed",
              from_address: from,
              to_address: message.to,
              body: message.body,
              provider: "twilio",
              provider_id: delivery.sent ? delivery.sid : null,
              error: delivery.sent ? null : "Twilio rejected the text",
              account_id: message.accountId,
              invoice_id: message.invoiceId,
              activity_id: activity?.id ?? null,
            });
            return { sent: delivery.sent };
          }
        : undefined,
      templateForOrg:
        config && admin
          ? async (orgId) => {
              const { data } = await admin
                .from("message_templates")
                .select("body")
                .eq("org_id", orgId)
                .eq("channel", "sms")
                .eq("purpose", "reminder")
                .eq("is_default", true)
                .maybeSingle();
              return data?.body ?? null;
            }
          : undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "payment reminders failed";
    console.error(message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
