"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { QBO_NOT_CONNECTED, qboConfigured } from "@/lib/billing/qbo";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function resolveQboConflict(conflictId: string, choice: "kept_ours" | "kept_theirs"): Promise<ActionResult> {
  const session = await requireOrg();
  if (session.orgRole !== "owner" && session.orgRole !== "admin") return fail("Only owners and admins can resolve a QuickBooks conflict.");
  if (!qboConfigured()) return fail(QBO_NOT_CONNECTED);
  if (!z.string().uuid().safeParse(conflictId).success) return fail("Conflict not found.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_qbo_conflict", { p_id: conflictId, p_choice: choice });
  if (error) return fail(error.message);
  revalidatePath("/settings/quickbooks");
  return { ok: true };
}
