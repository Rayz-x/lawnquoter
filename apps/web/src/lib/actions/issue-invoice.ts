"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { tryAutoChargeVisitInvoice } from "@/lib/billing/auto-charge-visit";
import { notifyIssuedInvoice } from "@/lib/billing/notify-issued-invoice";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const issueResultSchema = z.object({
  invoices: z.array(
    z.object({
      id: z.string().uuid(),
      number_label: z.string().nullable().optional(),
    }),
  ),
});

/**
 * Issues a draft invoice (I04 RPC) then emails the billing contact with
 * the tokenized public link + PDF (I05).
 */
export async function issueInvoiceAndNotify(
  invoiceId: string,
): Promise<ActionResult<{ invoiceIds: string[]; emailed: boolean; publicToken: string | null }>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, ADMIN_ROLES)) {
    return fail("Only an owner or admin can issue invoices.");
  }
  const parsed = z.string().uuid().safeParse(invoiceId);
  if (!parsed.success) return fail("Invoice not found");

  const supabase = await createClient();
  const client = supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("issue_invoice", { p_invoice_id: parsed.data });
  if (error) return fail(error.message);

  const body = issueResultSchema.safeParse(data);
  if (!body.success) return fail("Could not read issue result.");

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let emailed = false;
  let publicToken: string | null = null;
  for (const issued of body.data.invoices) {
    try {
      const notice = await notifyIssuedInvoice({
        supabase,
        invoiceId: issued.id,
        orgId: session.orgId,
        appBaseUrl: base,
      });
      emailed = emailed || notice.emailed;
      if (!publicToken) publicToken = notice.publicToken;
    } catch {
      // The invoice is already issued. A failed email must not skip the card charge.
    }
    await tryAutoChargeVisitInvoice(issued.id);
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${parsed.data}`);
  return { ok: true, data: { invoiceIds: body.data.invoices.map((i) => i.id), emailed, publicToken } };
}
