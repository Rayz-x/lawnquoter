"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { PAID_ROUTING_HINT, quoteRoute, routingConfigured, routingEnv, type RouteStop } from "@/lib/scheduling/route-optimize";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();

const pointSchema = z.object({
  visit_id: idSchema,
  sort: z.number().int(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

export async function optimizeRoute(
  routeId: string,
  source: "heuristic" | "api",
): Promise<ActionResult<{ source: "heuristic" | "api"; stops: number }>> {
  await requireOrg();
  const parsed = z.object({ routeId: idSchema, source: z.enum(["heuristic", "api"]) }).safeParse({ routeId, source });
  if (!parsed.success) return fail("Invalid route");
  const env = routingEnv(process.env);
  if (parsed.data.source === "api" && !routingConfigured(env)) {
    return fail(PAID_ROUTING_HINT);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("route_stop_points", { p_route_id: parsed.data.routeId });
  if (error || data == null) return fail(error?.message ?? "Could not read this route");
  const points = z.array(pointSchema).safeParse(data);
  if (!points.success) return fail("Could not read this route");
  if (points.data.length < 2) return fail("Add at least two stops before estimating drive time.");
  if (points.data.some((point) => point.lat == null || point.lng == null)) {
    return fail("Every stop needs a map location before drive times can be estimated.");
  }

  const stops: RouteStop[] = [...points.data]
    .sort((a, b) => a.sort - b.sort || a.visit_id.localeCompare(b.visit_id))
    .map((point) => ({ id: point.visit_id, lat: point.lat as number, lng: point.lng as number }));

  let quote;
  try {
    quote = await quoteRoute(stops, env, fetch, parsed.data.source);
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : "Routing service did not answer");
  }

  const { error: applyError } = await supabase.rpc("apply_optimized_route", {
    p_route_id: parsed.data.routeId,
    p_visit_ids: quote.legs.map((leg) => leg.visitId),
    p_drive_minutes: quote.legs.map((leg) => leg.driveMinutes),
    p_optimizer: quote.source,
  });
  if (applyError) return fail(applyError.message);
  return { ok: true, data: { source: quote.source, stops: quote.legs.length } };
}
