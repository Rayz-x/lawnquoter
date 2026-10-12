"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { deliverSms, mayText, readTwilioConfig, toE164, TWILIO_NOT_CONNECTED } from "@/lib/messaging/sms";
import { createClient } from "@/lib/supabase/server";

export async function saveSmsNumber(fd: FormData): Promise<void> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) redirect("/inbox?error=Only%20an%20owner%20or%20admin%20can%20set%20the%20texting%20number.");
  const raw = String(fd.get("sms_number") ?? "").trim();
  const smsNumber = raw ? toE164(raw) : null;
  if (raw && !smsNumber) redirect("/inbox?error=Enter%20a%2010-digit%20texting%20number.");
  const supabase = await createClient();
  const { error } = await supabase.from("orgs").update({ sms_number: smsNumber }).eq("id", session.orgId);
  if (error) redirect(`/inbox?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/inbox");
  redirect("/inbox");
}

export async function sendText(fd: FormData): Promise<void> {
  const session = await requireOrg();
  const rawTo = String(fd.get("to") ?? "");
  const to = toE164(rawTo);
  const body = String(fd.get("body") ?? "").trim();
  const back = (message: string) => redirect(`/inbox?phone=${encodeURIComponent(to ?? rawTo)}&error=${encodeURIComponent(message)}`);
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) return back("You cannot send texts.");
  if (!to) return back("Enter a mobile number.");
  if (!body || body.length > 1600) return back("Enter a text up to 1,600 characters.");
  const config = readTwilioConfig(process.env);
  if (!config) return back(TWILIO_NOT_CONNECTED);

  const supabase = await createClient();
  const [{ data: org }, { data: contacts }, { data: inbound }] = await Promise.all([
    supabase.from("orgs").select("sms_number").eq("id", session.orgId).maybeSingle(),
    supabase.from("contacts").select("id, account_id, phone, sms_opt_in").eq("org_id", session.orgId).not("phone", "is", null),
    supabase.from("messages").select("id").eq("org_id", session.orgId).eq("direction", "in").eq("from_address", to).limit(1),
  ]);
  const contact = (contacts ?? []).find((row) => toE164(row.phone ?? "") === to) ?? null;
  const allowed = mayText({ optedIn: Boolean(contact?.sms_opt_in), inbound: Boolean(inbound?.length) });
  if (!allowed.ok) return back(allowed.error);

  const from = org?.sms_number ? toE164(org.sms_number) ?? config.fromNumber : config.fromNumber;
  const delivery = await deliverSms({ config, to, from, body, fetch: (url, init) => fetch(url, init) });
  const { data: activity, error: activityError } = await supabase.from("activities").insert({
    org_id: session.orgId,
    account_id: contact?.account_id ?? null,
    actor_id: session.userId,
    kind: "sms.out",
    summary: delivery.sent ? `Text to ${to}` : `Text to ${to} failed`,
    meta: { to },
  }).select("id").single();
  if (activityError) return back(activityError.message);
  const { error } = await supabase.from("messages").insert({
    org_id: session.orgId,
    channel: "sms",
    direction: "out",
    status: delivery.sent ? "sent" : "failed",
    from_address: from,
    to_address: to,
    body,
    provider: "twilio",
    provider_id: delivery.sent ? delivery.sid : null,
    error: delivery.sent ? null : "Twilio rejected the text",
    account_id: contact?.account_id ?? null,
    contact_id: contact?.id ?? null,
    activity_id: activity.id,
  });
  if (error) return back(error.message);
  revalidatePath("/inbox");
  if (!delivery.sent) return back("Twilio rejected the text.");
  redirect(`/inbox?phone=${encodeURIComponent(to)}`);
}
