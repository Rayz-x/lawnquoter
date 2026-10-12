"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasRole, ADMIN_ROLES } from "@lawnquoter/shared";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function setFollowUps(fd: FormData): Promise<void> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) redirect("/settings/follow-ups?error=Only%20an%20owner%20or%20admin%20can%20change%20follow-ups.");
  const active = fd.get("active") === "on";
  const supabase = await createClient();
  const { error } = await supabase.from("automations").upsert({ org_id: session.orgId, purpose: "follow_up", active }, { onConflict: "org_id,purpose" });
  if (error) redirect(`/settings/follow-ups?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/settings/follow-ups");
  redirect("/settings/follow-ups");
}
