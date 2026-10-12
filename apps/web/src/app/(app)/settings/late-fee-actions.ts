"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { hasRole } from "@lawnquoter/shared";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { createClient } from "@/lib/supabase/server";

const saveSchema = z.object({
  flatCents: z.number().int().min(0).max(1_000_000),
  feeBps: z.number().int().min(0).max(10000),
  graceDays: z.number().int().min(0).max(365),
});

export async function saveLateFees(input: {
  flatCents: number;
  feeBps: number;
  graceDays: number;
}): Promise<ActionResult> {
  const session = await requireOrg();
  if (session.orgRole !== "owner" && session.orgRole !== "admin") return fail("Only owners and admins can change late fees.");
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("Check the late fee amounts and try again.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("orgs")
    .update({
      late_fee_flat_cents: parsed.data.flatCents,
      late_fee_bps: parsed.data.feeBps,
      late_fee_grace_days: parsed.data.graceDays,
    })
    .eq("id", session.orgId);
  if (error) return fail(error.message);
  revalidatePath("/settings");
  return { ok: true };
}

export async function applyLateFees(): Promise<ActionResult<{ count: number }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) return fail("You cannot add late fees.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_late_fees");
  if (error) return fail(error.message);
  revalidatePath("/invoices");
  revalidatePath("/settings");
  return { ok: true, data: { count: data ?? 0 } };
}
