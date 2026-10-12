"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function setFixedRouteDay(agreementId: string, fixed: boolean): Promise<ActionResult> {
  await requireOrg();
  const parsed = z.object({ agreementId: z.string().uuid(), fixed: z.boolean() }).safeParse({ agreementId, fixed });
  if (!parsed.success) return fail("Invalid agreement");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_agreement_fixed_route_day", {
    p_agreement_id: parsed.data.agreementId,
    p_fixed: parsed.data.fixed,
  });
  if (error) return fail(error.message);
  return { ok: true };
}
