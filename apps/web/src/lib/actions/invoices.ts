"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const batchResultSchema = z.object({
  invoice_count: z.number().int().nonnegative(),
  visit_count: z.number().int().nonnegative(),
  invoice_ids: z.array(z.string().uuid()).optional(),
});

export async function createInvoicesBatch(
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult<{ invoiceCount: number; visitCount: number }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) {
    return fail("Only office staff can create invoices.");
  }
  const parsed = z
    .object({ periodStart: dateSchema, periodEnd: dateSchema })
    .safeParse({ periodStart, periodEnd });
  if (!parsed.success) return fail("Enter a valid billing period.");
  if (parsed.data.periodEnd < parsed.data.periodStart) {
    return fail("Period end must be on or after the start.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invoices_batch", {
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
  });
  if (error) return fail(error.message);

  const body = batchResultSchema.safeParse(data);
  if (!body.success) return fail("Could not read invoice batch result.");

  revalidatePath("/invoices");
  return {
    ok: true,
    data: {
      invoiceCount: body.data.invoice_count,
      visitCount: body.data.visit_count,
    },
  };
}
