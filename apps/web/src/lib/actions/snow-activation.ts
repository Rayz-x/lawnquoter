"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inches: z.number(),
});

export async function activateSnowEvent(input: z.infer<typeof inputSchema>): Promise<ActionResult<{ created: number }>> {
  await requireOrg();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Enter the day and how many inches fell");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activate_snow_event", {
    p_event_date: parsed.data.eventDate,
    p_inches: parsed.data.inches,
  });
  if (error) return fail(error.message);
  return { ok: true, data: { created: data ?? 0 } };
}
