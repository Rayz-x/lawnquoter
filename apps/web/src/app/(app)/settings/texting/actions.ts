"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { requireOrg } from "@/lib/auth/session";
import { A2P_ALREADY_SUBMITTED, a2pCanSubmit, parseA2pDraft, submitA2p } from "@/lib/messaging/a2p";
import { readTwilioConfig, TWILIO_NOT_CONNECTED } from "@/lib/messaging/sms";
import { createClient } from "@/lib/supabase/server";

function back(message: string): never {
  redirect(`/settings/texting?error=${encodeURIComponent(message)}`);
}

function draftFrom(fd: FormData) {
  return {
    legalName: String(fd.get("legal_name") ?? ""),
    ein: String(fd.get("ein") ?? ""),
    website: String(fd.get("website") ?? ""),
    email: String(fd.get("contact_email") ?? ""),
    sample: String(fd.get("sample_message") ?? ""),
  };
}

export async function saveA2p(fd: FormData): Promise<void> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) back("Only an owner or admin can save texting registration.");
  const parsed = parseA2pDraft(draftFrom(fd));
  if (!parsed.ok) back(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("org_sms_registrations").upsert({
    org_id: session.orgId,
    legal_name: parsed.value.legalName,
    ein: parsed.value.ein,
    website: parsed.value.website,
    contact_email: parsed.value.email,
    sample_message: parsed.value.sample,
  });
  if (error) back(error.message);
  revalidatePath("/settings/texting");
  redirect("/settings/texting");
}

export async function submitA2pForm(): Promise<void> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) back("Only an owner or admin can submit texting registration.");
  const config = readTwilioConfig(process.env);
  if (!config) back(TWILIO_NOT_CONNECTED);
  const supabase = await createClient();
  const { data: row } = await supabase.from("org_sms_registrations").select("legal_name, ein, website, contact_email, sample_message, brand_status, campaign_status, brand_sid, campaign_sid").eq("org_id", session.orgId).maybeSingle();
  const registration = {
    brandStatus: row?.brand_status ?? "draft",
    campaignStatus: row?.campaign_status ?? "draft",
    brandSid: row?.brand_sid,
    campaignSid: row?.campaign_sid,
  };
  if (!a2pCanSubmit(registration)) back(A2P_ALREADY_SUBMITTED);
  const draft = {
    legalName: row?.legal_name ?? "",
    ein: row?.ein ?? "",
    website: row?.website ?? "",
    email: row?.contact_email ?? "",
    sample: row?.sample_message ?? "",
  };
  const parsed = parseA2pDraft(draft);
  if (!parsed.ok) back(parsed.error);
  const { data: claimed, error: claimError } = await supabase
    .from("org_sms_registrations")
    .update({ brand_status: "pending", campaign_status: "pending", last_error: null })
    .eq("org_id", session.orgId)
    .eq("brand_status", "draft")
    .eq("campaign_status", "draft")
    .is("brand_sid", null)
    .is("campaign_sid", null)
    .select("org_id");
  if (claimError) back(claimError.message);
  if (!claimed?.length) back(A2P_ALREADY_SUBMITTED);
  const result = await submitA2p({
    config,
    draft,
    registration,
    fetch: (url, init) => fetch(url, init),
  });
  if (!result.ok) {
    if (result.error !== A2P_ALREADY_SUBMITTED) {
      await supabase.from("org_sms_registrations").update({ brand_status: "failed", campaign_status: "failed", last_error: result.error }).eq("org_id", session.orgId);
    }
    back(result.error);
  }
  const { error } = await supabase.from("org_sms_registrations").update({
    brand_status: "pending",
    campaign_status: "pending",
    brand_sid: result.brandSid,
    campaign_sid: result.campaignSid,
    messaging_service_sid: result.messagingServiceSid,
    last_error: null,
  }).eq("org_id", session.orgId);
  if (error) back(error.message);
  revalidatePath("/settings/texting");
  redirect("/settings/texting");
}
