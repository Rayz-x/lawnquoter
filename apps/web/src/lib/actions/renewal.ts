"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ruleSchema = z.object({
  percent: z.number(),
  windowDays: z.number().int(),
});

export async function saveRenewalRule(input: z.infer<typeof ruleSchema>): Promise<ActionResult> {
  await requireOrg();
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return fail("Percent has to be 0 to 100, and the window 1 to 365 days");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_renewal_rule", {
    p_percent: parsed.data.percent,
    p_window_days: parsed.data.windowDays,
  });
  if (error) return fail(error.message);
  return { ok: true };
}

export async function proposeRenewal(agreementId: string): Promise<ActionResult<{ quoteId: string }>> {
  await requireOrg();
  if (!z.string().uuid().safeParse(agreementId).success) return fail("Pick an agreement");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("propose_agreement_renewal", { p_agreement: agreementId });
  if (error) return fail(error.message);
  if (!data) return fail("Could not create the renewal");
  return { ok: true, data: { quoteId: data } };
}
