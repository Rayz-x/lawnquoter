"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  accountId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function createConsolidatedInvoice(input: {
  accountId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<ActionResult<{ id: string }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) return fail("You cannot create invoices.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Choose a start and end date.");
  if (parsed.data.periodEnd < parsed.data.periodStart) return fail("The end date must be on or after the start.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_consolidated_invoice", {
    p_account_id: parsed.data.accountId,
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
  });
  if (error) return fail(error.message);
  if (!data) return fail("Could not create the consolidated invoice.");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  return { ok: true, data: { id: data } };
}
