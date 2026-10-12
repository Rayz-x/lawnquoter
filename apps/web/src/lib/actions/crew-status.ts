"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { isCrewStatus } from "@/lib/scheduling/crew-status";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  visitId: z.string().uuid(),
  state: z.string(),
});

export async function setCrewStatus(input: z.infer<typeof inputSchema>): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success || !isCrewStatus(parsed.data.state)) return fail("Pick en route, on site, break, or done");
  const supabase = await createClient();
  const { data: visit, error: visitError } = await supabase
    .from("visits")
    .select("id, route_id, routes(crew_id)")
    .eq("id", parsed.data.visitId)
    .maybeSingle();
  if (visitError) return fail(visitError.message);
  const route = Array.isArray(visit?.routes) ? visit.routes[0] : visit?.routes;
  const crewId = route?.crew_id;
  if (!crewId) return fail("This stop is not on a crew yet");
  const { error } = await supabase.from("crew_status").upsert(
    {
      org_id: session.orgId,
      crew_id: crewId,
      profile_id: session.userId,
      visit_id: parsed.data.visitId,
      state: parsed.data.state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,crew_id" },
  );
  if (error) return fail(error.message);
  return { ok: true };
}
