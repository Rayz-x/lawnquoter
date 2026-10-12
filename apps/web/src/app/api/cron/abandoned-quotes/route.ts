import { createEmailProvider } from "@/lib/email/provider";
import { isAbandonedQuote } from "@/lib/quotes/abandoned";
import { deliverSms, readTwilioConfig, toE164 } from "@/lib/messaging/sms";
import { renderTemplate, suggestedTemplate } from "@/lib/messaging/template";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const now = Date.now();
  const { data: quotes } = await admin.from("quotes").select("id, org_id, account_id, status, viewed_at, public_token, abandoned_at").eq("status", "viewed").is("abandoned_at", null);
  const accountIds = [...new Set((quotes ?? []).map((quote) => quote.account_id))];
  const { data: replies } = accountIds.length
    ? await admin.from("messages").select("account_id, occurred_at").eq("direction", "in").in("account_id", accountIds)
    : { data: [] };
  const config = readTwilioConfig(process.env);
  const emailReady = process.env.NODE_ENV !== "test" && !process.env.VITEST && Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
  let sent = 0;
  for (const quote of quotes ?? []) {
    const replied = (replies ?? []).some((message) => message.account_id === quote.account_id && quote.viewed_at && message.occurred_at >= quote.viewed_at);
    if (!isAbandonedQuote({ status: quote.status, viewedAt: quote.viewed_at, replied, alreadySent: Boolean(quote.abandoned_at), asOfMs: now })) continue;
    const [{ data: account }, { data: org }, { data: contacts }] = await Promise.all([
      admin.from("accounts").select("name, email, billing_email").eq("id", quote.account_id).maybeSingle(),
      admin.from("orgs").select("name, sms_number").eq("id", quote.org_id).maybeSingle(),
      admin.from("contacts").select("id, phone, sms_opt_in").eq("account_id", quote.account_id),
    ]);
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const link = `${base}/q/${quote.public_token}`;
    const values = { customerName: account?.name ?? "there", company: org?.name ?? "us", link, amount: "", address: "" };
    const text = renderTemplate(suggestedTemplate("sms", "abandoned").body, values);
    const contact = (contacts ?? []).find((row) => row.sms_opt_in && toE164(row.phone ?? ""));
    const phone = contact ? toE164(contact.phone ?? "") : null;
    const emailTo = account?.billing_email?.trim() || account?.email?.trim() || "";
    let delivered = false;
    if (config && phone) {
      const from = org?.sms_number ? toE164(org.sms_number) ?? config.fromNumber : config.fromNumber;
      const delivery = await deliverSms({ config, to: phone, from, body: text, fetch: (url, init) => fetch(url, init) });
      delivered = delivery.sent;
      if (delivered) {
        const { data: activity } = await admin.from("activities").insert({ org_id: quote.org_id, account_id: quote.account_id, kind: "sms.out", summary: `Text to ${phone}`, meta: { quote_id: quote.id } }).select("id").single();
        await admin.from("messages").insert({ org_id: quote.org_id, channel: "sms", direction: "out", status: "sent", from_address: from, to_address: phone, body: text, provider: "twilio", account_id: quote.account_id, contact_id: contact?.id ?? null, quote_id: quote.id, activity_id: activity?.id ?? null });
      }
    } else if (emailReady && emailTo) {
      const email = suggestedTemplate("email", "abandoned");
      const result = await createEmailProvider().send({ to: emailTo, subject: email.subject ?? "Your quote is still open", text: renderTemplate(email.body, values) });
      delivered = result.sent;
      if (delivered) {
        await admin.from("activities").insert({ org_id: quote.org_id, account_id: quote.account_id, kind: "email.out", summary: `Email to ${emailTo}`, meta: { quote_id: quote.id } });
      }
    }
    if (!delivered && (phone || emailTo)) continue;
    await admin.from("quotes").update({ abandoned_at: new Date(now).toISOString() }).eq("id", quote.id);
    if (delivered) sent += 1;
  }
  return Response.json({ ok: true, sent });
}
