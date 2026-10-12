import type { createAdminClient } from "@/lib/supabase/server";
import { trackedCallActivityMeta } from "./calls";
import { toE164 } from "./sms";
import type { TrackedCall } from "./calls";

type Admin = ReturnType<typeof createAdminClient>;

export async function recordTrackedCall(admin: Admin, call: TrackedCall, provider: "callrail" | "twilio"): Promise<{ ok: true; duplicate?: boolean } | { ok: false; status: number; error: string }> {
  const { data: org } = await admin.from("orgs").select("id").eq("call_tracking_number", call.to).maybeSingle();
  if (!org) return { ok: false, status: 404, error: "unknown_number" };
  const { data: contacts } = await admin.from("contacts").select("id, account_id, phone").eq("org_id", org.id).not("phone", "is", null);
  const contact = (contacts ?? []).find((row) => toE164(row.phone ?? "") === call.from) ?? null;
  const { data: activity, error: activityError } = await admin.from("activities").insert({
    org_id: org.id,
    account_id: contact?.account_id ?? null,
    kind: call.direction === "out" ? "call.out" : "call.in",
    summary: call.direction === "out" ? `Call to ${call.from}` : `Call from ${call.from}`,
    meta: trackedCallActivityMeta(call.providerId),
  }).select("id").single();
  if (activityError || !activity) return { ok: false, status: 500, error: activityError?.message ?? "activity" };
  const { error } = await admin.from("calls").insert({
    org_id: org.id,
    direction: call.direction,
    from_address: call.from,
    to_address: call.to,
    duration_seconds: call.duration,
    recording_url: call.recordingUrl,
    provider,
    provider_id: call.providerId,
    account_id: contact?.account_id ?? null,
    contact_id: contact?.id ?? null,
    activity_id: activity.id,
  });
  if (error?.code === "23505") return { ok: true, duplicate: true };
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true };
}
