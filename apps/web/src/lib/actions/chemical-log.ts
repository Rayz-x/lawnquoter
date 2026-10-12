"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { chemicalLog } from "@/lib/crew/chemical-log";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  visitId: z.string().uuid(),
  product: z.string(),
  rate: z.string(),
  epaRegNo: z.string(),
  tempF: z.number(),
  windMph: z.number(),
  conditions: z.string(),
});

export async function logChemicalApplication(input: z.infer<typeof inputSchema>): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid chemical log");
  const parsedLog = chemicalLog(parsed.data);
  if (!parsedLog.ok) return fail(parsedLog.error);
  const log = parsedLog.log;
  const supabase = await createClient();
  const { error } = await supabase.from("chemical_applications").insert({
    org_id: session.orgId,
    visit_id: parsed.data.visitId,
    product: log.product,
    rate: log.rate,
    epa_reg_no: log.epaRegNo,
    temp_f: log.tempF,
    wind_mph: log.windMph,
    conditions: log.conditions || null,
    recorded_by: session.userId,
  });
  if (error) return fail(error.message);
  return { ok: true };
}
