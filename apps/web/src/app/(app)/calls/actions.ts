"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { requireOrg } from "@/lib/auth/session";
import { trackingNumberAssignedToOrg } from "@/lib/messaging/calls";
import { readTwilioConfig, toE164 } from "@/lib/messaging/sms";
import { createClient } from "@/lib/supabase/server";

export async function saveTrackingNumber(fd: FormData): Promise<void> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) redirect("/calls?error=Only%20an%20owner%20or%20admin%20can%20set%20the%20tracking%20number.");
  const raw = String(fd.get("call_tracking_number") ?? "").trim();
  const number = raw ? toE164(raw) : null;
  if (raw && !number) redirect("/calls?error=Enter%20a%2010-digit%20tracking%20number.");
  if (number) {
    const assigned = await trackingNumberAssignedToOrg({
      config: readTwilioConfig(process.env),
      orgId: session.orgId,
      trackingNumber: number,
      fetch: (url, init) => fetch(url, init),
    });
    if (!assigned.ok) redirect(`/calls?error=${encodeURIComponent(assigned.error)}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("orgs").update({ call_tracking_number: number }).eq("id", session.orgId);
  if (error) redirect(`/calls?error=${encodeURIComponent(error.code === "23505" ? "That tracking number is already used by another company." : error.message)}`);
  revalidatePath("/calls");
  redirect("/calls");
}
