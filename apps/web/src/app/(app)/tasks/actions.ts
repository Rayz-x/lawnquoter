"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasRole } from "@lawnquoter/shared";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function completeTask(fd: FormData): Promise<void> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) redirect("/tasks?error=You%20cannot%20finish%20tasks.");
  const id = String(fd.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ status: "done" }).eq("id", id).eq("org_id", session.orgId);
  if (error) redirect(`/tasks?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/tasks");
  redirect("/tasks");
}
