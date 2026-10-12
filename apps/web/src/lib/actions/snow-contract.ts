"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { SNOW_CONTRACTS } from "@/lib/agreements/snow-contract";
import { createClient } from "@/lib/supabase/server";

const tierSchema = z.object({
  upTo: z.number().positive().nullable(),
  price: z.number().nonnegative(),
});

const inputSchema = z.object({
  agreementId: z.string().uuid(),
  contract: z.enum(SNOW_CONTRACTS),
  triggerDepthIn: z.number().nonnegative(),
  price: z.number().nonnegative(),
  tiers: z.array(tierSchema).max(6).optional(),
});

export async function saveSnowContract(input: z.infer<typeof inputSchema>): Promise<ActionResult> {
  await requireOrg();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid snow contract");
  if (parsed.data.contract === "per_inch" && !(parsed.data.tiers && parsed.data.tiers.length > 0)) {
    return fail("Per-inch snow needs at least one tier");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_agreement_snow_contract", {
    p_agreement_id: parsed.data.agreementId,
    p_contract: parsed.data.contract,
    p_trigger_depth: parsed.data.triggerDepthIn,
    p_price: parsed.data.price,
    p_tiers: parsed.data.contract === "per_inch" ? (parsed.data.tiers ?? []) : null,
  });
  if (error) return fail(error.message);
  return { ok: true };
}
