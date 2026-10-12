import { createEmailProvider } from "@/lib/email/provider";
import { planFollowUps, type FollowUpQuote } from "@/lib/messaging/follow-up";
import { claimedSmsFrom, deliverSms, readTwilioConfig, toE164 } from "@/lib/messaging/sms";
import { renderTemplate, suggestedTemplate } from "@/lib/messaging/template";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: automations } = await admin.from("automations").select("org_id").eq("purpose", "follow_up").eq("active", true);
  const orgIds = (automations ?? []).map((row) => row.org_id);
  if (orgIds.length === 0) return Response.json({ ok: true, acted: 0 });
  const { data: quotes } = await admin.from("quotes").select("id, org_id, account_id, status, sent_at, viewed_at").in("org_id", orgIds).in("status", ["sent", "viewed", "accepted", "declined"]).not("sent_at", "is", null);
  const quoteIds = (quotes ?? []).map((quote) => quote.id);
  const [{ data: runs }, { data: messages }] = await Promise.all([
    admin.from("automation_runs").select("id, quote_id, steps_sent, status, task_id").in("quote_id", quoteIds.length ? quoteIds : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("messages").select("account_id, occurred_at").eq("direction", "in").in("org_id", orgIds),
  ]);
  const now = new Date();
  let acted = 0;
  for (const orgId of orgIds) {
    const planned = (quotes ?? []).filter((quote) => quote.org_id === orgId).map((quote): FollowUpQuote => {
      const run = (runs ?? []).find((row) => row.quote_id === quote.id && row.status === "active");
      const replied = (messages ?? []).some((message) => message.account_id === quote.account_id && quote.sent_at && message.occurred_at >= quote.sent_at);
      return {
        id: quote.id,
        accountId: quote.account_id,
        status: quote.status,
        sentAt: quote.sent_at ?? now.toISOString(),
        viewed: Boolean(quote.viewed_at) || quote.status === "viewed",
        replied,
        stepsSent: run?.steps_sent ?? 0,
        taskOpen: Boolean(run?.task_id),
        runId: run?.id ?? null,
      };
    });
    for (const action of planFollowUps(planned, now)) {
      const did = await applyFollowUp(admin, orgId, action);
      if (did) acted += 1;
    }
  }
  return Response.json({ ok: true, acted });
}

async function applyFollowUp(admin: ReturnType<typeof createAdminClient>, orgId: string, action: ReturnType<typeof planFollowUps>[number]): Promise<boolean> {
  if (action.type === "start") {
    const { error } = await admin.from("automation_runs").insert({ org_id: orgId, quote_id: action.quoteId });
    return !error;
  }
  if (action.type === "stop") {
    const { error } = await admin.from("automation_runs").update({ status: "stopped", stop_reason: action.reason }).eq("id", action.runId);
    return !error;
  }
  if (action.type === "call") {
    const { data: task, error } = await admin.from("tasks").insert({ org_id: orgId, account_id: action.accountId, quote_id: action.quoteId, kind: "call", title: "Call about this quote", due_on: new Date().toISOString().slice(0, 10) }).select("id").single();
    if (error || !task) return false;
    await admin.from("automation_runs").update({ status: "completed", task_id: task.id }).eq("id", action.runId);
    return true;
  }
  const config = readTwilioConfig(process.env);
  const emailReady = process.env.NODE_ENV !== "test" && !process.env.VITEST && Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
  if (action.channel === "sms" && !config) return false;
  if (action.channel === "email" && !emailReady) return false;
  const [{ data: quote }, { data: account }, { data: org }, { data: contacts }] = await Promise.all([
    admin.from("quotes").select("public_token").eq("id", action.quoteId).maybeSingle(),
    admin.from("accounts").select("name, email, billing_email").eq("id", action.accountId).maybeSingle(),
    admin.from("orgs").select("name, sms_number").eq("id", orgId).maybeSingle(),
    admin.from("contacts").select("phone, sms_opt_in").eq("account_id", action.accountId),
  ]);
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const link = quote?.public_token ? `${base}/q/${quote.public_token}` : "";
  const body = renderTemplate(suggestedTemplate(action.channel, "follow_up").body, { customerName: account?.name ?? "there", company: org?.name ?? "us", link, amount: "", address: "" });
  let to = "";
  let from = process.env.EMAIL_FROM?.trim() || "email";
  if (action.channel === "sms") {
    const contact = (contacts ?? []).find((row) => row.sms_opt_in && toE164(row.phone ?? ""));
    to = contact ? toE164(contact.phone ?? "") ?? "" : "";
    from = claimedSmsFrom(org?.sms_number) ?? "";
    if (!to || !from || !config) return false;
    const delivery = await deliverSms({ config, to, from, body, fetch: (url, init) => fetch(url, init) });
    if (!delivery.sent) return false;
  } else {
    to = account?.billing_email?.trim() || account?.email?.trim() || "";
    if (!to) return false;
    const sent = await createEmailProvider().send({ to, subject: suggestedTemplate("email", "follow_up").subject ?? "Following up", text: body });
    if (!sent.sent) return false;
  }
  const { data: activity } = await admin.from("activities").insert({
    org_id: orgId,
    account_id: action.accountId,
    kind: action.channel === "sms" ? "sms.out" : "email.out",
    summary: action.channel === "sms" ? `Text to ${to}` : `Email to ${to}`,
    meta: { quote_id: action.quoteId },
  }).select("id").single();
  await admin.from("messages").insert({
    org_id: orgId,
    channel: action.channel,
    direction: "out",
    status: "sent",
    from_address: from,
    to_address: to,
    body,
    provider: action.channel === "sms" ? "twilio" : "resend",
    account_id: action.accountId,
    quote_id: action.quoteId,
    activity_id: activity?.id ?? null,
  });
  if (action.runId) await admin.from("automation_runs").update({ steps_sent: action.nextSteps }).eq("id", action.runId);
  else await admin.from("automation_runs").insert({ org_id: orgId, quote_id: action.quoteId, steps_sent: action.nextSteps });
  return true;
}
