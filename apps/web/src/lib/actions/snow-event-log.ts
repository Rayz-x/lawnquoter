"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { snowEventLog } from "@/lib/crew/snow-event-log";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  visitId: z.string().uuid(),
  triggerIn: z.number(),
  startedAt: z.string(),
  endedAt: z.string(),
  materials: z.string(),
});

export async function logSnowEvent(input: z.infer<typeof inputSchema>): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid snow event");
  const result = snowEventLog(parsed.data);
  if (!result.ok) return fail(result.error);
  const log = result.log;
  const supabase = await createClient();
  const { error } = await supabase.from("snow_event_logs").insert({
    org_id: session.orgId,
    visit_id: parsed.data.visitId,
    trigger_depth_in: log.triggerIn,
    started_at: log.startedAt,
    ended_at: log.endedAt,
    materials: log.materials,
    recorded_by: session.userId,
  });
  if (error) return fail(error.message);
  return { ok: true };
}
