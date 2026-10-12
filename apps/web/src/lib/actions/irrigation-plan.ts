"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  agreementId: z.string().uuid(),
  zones: z.number().int().positive().max(200),
  minutesPerZone: z.number().int().positive().max(180),
  pricePerZone: z.number().nonnegative(),
});

export async function saveIrrigationPlan(input: z.infer<typeof inputSchema>): Promise<ActionResult> {
  await requireOrg();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid irrigation plan");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_agreement_irrigation_plan", {
    p_agreement_id: parsed.data.agreementId,
    p_zones: parsed.data.zones,
    p_minutes_per_zone: parsed.data.minutesPerZone,
    p_price_per_zone: parsed.data.pricePerZone,
  });
  if (error) return fail(error.message);
  return { ok: true };
}
