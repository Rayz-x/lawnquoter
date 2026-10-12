"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  quoteId: z.string().uuid(),
  lineItemIds: z.array(z.string().uuid()).min(1),
  percent: z.number().int().min(1).max(100),
});

export async function createProgressInvoice(input: {
  quoteId: string;
  lineItemIds: string[];
  percent: number;
}): Promise<ActionResult<{ id: string }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) return fail("You cannot create invoices.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Choose at least one line and a percent from 1 to 100.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_progress_invoice", {
    p_quote_id: parsed.data.quoteId,
    p_line_item_ids: parsed.data.lineItemIds,
    p_percent: parsed.data.percent,
  });
  if (error) return fail(error.message);
  if (!data) return fail("Could not create the progress invoice.");
  revalidatePath(`/quotes/${parsed.data.quoteId}`);
  return { ok: true, data: { id: data } };
}
