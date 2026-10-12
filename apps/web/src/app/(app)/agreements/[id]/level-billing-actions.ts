"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const configureSchema = z.object({
  agreementId: z.string().uuid(),
  seasonPriceCents: z.number().int().positive(),
  billingMonths: z.number().int().min(1).max(24),
});

export async function configureLevelBilling(input: {
  agreementId: string;
  seasonPriceCents: number;
  billingMonths: number;
}): Promise<ActionResult> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, CUSTOMER_EDIT_ROLES)) return fail("You cannot change billing.");
  const parsed = configureSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a season price and 1 to 24 months.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("configure_level_billing", {
    p_agreement_id: parsed.data.agreementId,
    p_season_price_cents: parsed.data.seasonPriceCents,
    p_billing_months: parsed.data.billingMonths,
  });
  if (error) return fail(error.message);
  revalidatePath(`/agreements/${parsed.data.agreementId}`);
  return { ok: true };
}
