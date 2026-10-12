"use server";

import { revalidatePath } from "next/cache";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { crewMayTextOnMyWay, onMyWayText } from "./on-my-way";
import { claimedSmsFrom, deliverSms, readTwilioConfig, toE164, TWILIO_NOT_CONNECTED } from "./sms";

const CREW = ["crew", "crew_lead"] as const;

function named(value: { name?: string | null } | { name?: string | null }[] | null | undefined): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name?.trim() || "us";
}

export async function textOnMyWay(visitId: string): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES) && !hasRole(session.orgRole, CREW)) {
    return fail("You cannot send texts.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(visitId)) return fail("That stop was not found.");
  const supabase = await createClient();
  const { data: visit, error } = await supabase
    .from("visits")
    .select("id, status, property_id, route_id, properties(formatted_address, account_id)")
    .eq("id", visitId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (error) return fail(error.message);
  const property = Array.isArray(visit?.properties) ? visit.properties[0] : visit?.properties;
  const accountId = property?.account_id ?? null;
  if (!visit || !accountId) return fail("That stop was not found.");

  const office = hasRole(session.orgRole, CUSTOMER_EDIT_ROLES);
  if (!office) {
    let crewKnown = false;
    let openLeadId: string | null = null;
    let defaultLeadId: string | null = null;
    if (visit.route_id) {
      const { data: route } = await supabase.from("routes").select("crew_id, date").eq("id", visit.route_id).eq("org_id", session.orgId).maybeSingle();
      if (route?.crew_id) {
        crewKnown = true;
        const [{ data: openSession }, { data: crew }] = await Promise.all([
          supabase.from("crew_lead_sessions").select("lead_id").eq("org_id", session.orgId).eq("crew_id", route.crew_id).eq("route_date", route.date).is("ended_at", null).maybeSingle(),
          supabase.from("crews").select("default_lead_id").eq("id", route.crew_id).eq("org_id", session.orgId).maybeSingle(),
        ]);
        openLeadId = openSession?.lead_id ?? null;
        defaultLeadId = crew?.default_lead_id ?? null;
      }
    }
    const { data: membership } = await supabase.from("memberships").select("status").eq("org_id", session.orgId).eq("user_id", session.userId).maybeSingle();
    const allowed = crewMayTextOnMyWay({
      office: false,
      role: session.orgRole,
      userId: session.userId,
      active: membership?.status === "active",
      crewKnown,
      openLeadId,
      defaultLeadId,
    });
    if (!allowed) return fail("The crew lead sends that text.");
  }

  const admin = createAdminClient();
  const [{ data: org }, { data: template }, { data: contacts, error: contactError }] = await Promise.all([
    admin.from("orgs").select("name, sms_number").eq("id", session.orgId).maybeSingle(),
    admin.from("message_templates").select("body").eq("org_id", session.orgId).eq("channel", "sms").eq("purpose", "on_my_way").eq("is_default", true).maybeSingle(),
    admin.from("contacts").select("id, phone, sms_opt_in").eq("org_id", session.orgId).eq("account_id", accountId),
  ]);
  if (contactError) return fail(contactError.message);
  const numbers = (contacts ?? []).map((contact) => toE164(contact.phone ?? "")).filter((phone): phone is string => Boolean(phone));
  const inbound = numbers.length
    ? await admin.from("messages").select("from_address").eq("org_id", session.orgId).eq("direction", "in").in("from_address", numbers)
    : { data: [], error: null };
  if (inbound.error) return fail(inbound.error.message);
  const inboundSet = new Set((inbound.data ?? []).map((row) => row.from_address));
  const contact = (contacts ?? []).find((row) => row.sms_opt_in && toE164(row.phone ?? "")) ?? (contacts ?? []).find((row) => inboundSet.has(toE164(row.phone ?? "") ?? "")) ?? null;
  const config = readTwilioConfig(process.env);
  const composed = onMyWayText({
    templateBody: template?.body ?? null,
    company: named(org),
    address: property.formatted_address?.trim() || "",
    phone: contact?.phone ?? null,
    optedIn: Boolean(contact?.sms_opt_in),
    inbound: Boolean(contact && inboundSet.has(toE164(contact.phone ?? "") ?? "")),
    connected: config !== null,
    status: visit.status,
  });
  if (!composed.ok) return composed;
  if (!config) return fail(TWILIO_NOT_CONNECTED);

  const from = claimedSmsFrom(org?.sms_number);
  if (!from) return fail("Set the company's texting number in Texts before sending.");
  const delivery = await deliverSms({ config, to: composed.to, from, body: composed.body, fetch: (url, init) => fetch(url, init) });
  const { data: activity, error: activityError } = await admin
    .from("activities")
    .insert({
      org_id: session.orgId,
      account_id: accountId,
      property_id: visit.property_id,
      actor_id: session.userId,
      kind: "sms.out",
      summary: delivery.sent ? `Text to ${composed.to}` : `Text to ${composed.to} failed`,
      meta: { to: composed.to, visit_id: visitId },
    })
    .select("id")
    .single();
  if (activityError || !activity) return fail(activityError?.message ?? "Could not record the text.");
  const { error: messageError } = await admin.from("messages").insert({
    org_id: session.orgId,
    channel: "sms",
    direction: "out",
    status: delivery.sent ? "sent" : "failed",
    from_address: from,
    to_address: composed.to,
    body: composed.body,
    provider: "twilio",
    provider_id: delivery.sent ? delivery.sid : null,
    error: delivery.sent ? null : "Twilio rejected the text",
    account_id: accountId,
    contact_id: contact?.id ?? null,
    activity_id: activity.id,
  });
  if (messageError) return fail(messageError.message);
  revalidatePath(`/crew/visits/${visitId}`);
  if (!delivery.sent) return fail("Twilio rejected the text.");
  return { ok: true };
}
