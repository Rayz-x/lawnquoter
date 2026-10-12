"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { irrigationZoneNote } from "@/lib/crew/irrigation-zone-note";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  visitId: z.string().uuid(),
  zone: z.number(),
  note: z.string(),
});

export async function logIrrigationZoneNote(input: z.infer<typeof inputSchema>): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid zone note");
  const result = irrigationZoneNote(parsed.data);
  if (!result.ok) return fail(result.error);
  const supabase = await createClient();
  const { error } = await supabase.from("irrigation_zone_notes").insert({
    org_id: session.orgId,
    visit_id: parsed.data.visitId,
    zone_number: result.note.zone,
    note: result.note.note,
    recorded_by: session.userId,
  });
  if (error) return fail(error.message);
  return { ok: true };
}
