/**
 * Drive-time ordering for one crew day.
 *
 * The free estimate is nearest-neighbor at 25 mph. A paid routing service is
 * used only when both ROUTING_API_URL and ROUTING_API_KEY are set.
 */

export const DRIVE_MPH = 25;
const EARTH_MILES = 3958.8;

export const PAID_ROUTING_HINT =
  "Paid routing is not connected. Add ROUTING_API_KEY to enable it. Drive times use the free estimate.";

export type RouteStop = {
  id: string;
  lat: number;
  lng: number;
};

export type RouteLeg = {
  visitId: string;
  driveMinutes: number;
};

export type RouteQuote = {
  source: "heuristic" | "api";
  legs: RouteLeg[];
};

export type RoutingEnv = {
  ROUTING_API_URL?: string;
  ROUTING_API_KEY?: string;
};

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

export function routingConfigured(env: RoutingEnv): boolean {
  return Boolean(env.ROUTING_API_URL?.trim() && env.ROUTING_API_KEY?.trim());
}

/** ProcessEnv is a weak-type mismatch for RoutingEnv, so copy the two keys. */
export function routingEnv(env: NodeJS.ProcessEnv): RoutingEnv {
  return {
    ROUTING_API_URL: env.ROUTING_API_URL,
    ROUTING_API_KEY: env.ROUTING_API_KEY,
  };
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle miles. North-south distance is the meridian arc. */
export function milesBetween(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function driveMinutes(miles: number): number {
  if (miles <= 0) return 0;
  return Math.max(1, Math.round((miles / DRIVE_MPH) * 60));
}

/**
 * Nearest neighbor, starting at the first stop. The first leg is 0 minutes
 * (the crew is already there). Later legs are the drive from the previous stop.
 */
export function optimizeRoute(stops: RouteStop[]): RouteLeg[] {
  if (stops.length === 0) return [];
  const seen = new Set<string>();
  for (const stop of stops) {
    if (seen.has(stop.id)) throw new Error("duplicate stop");
    seen.add(stop.id);
  }
  const remaining = stops.slice(1);
  const ordered: RouteStop[] = [stops[0]!];
  let current = stops[0]!;
  while (remaining.length > 0) {
    let nearest = 0;
    let nearestMiles = milesBetween(current, remaining[0]!);
    for (let index = 1; index < remaining.length; index += 1) {
      const miles = milesBetween(current, remaining[index]!);
      if (miles < nearestMiles) {
        nearest = index;
        nearestMiles = miles;
      }
    }
    const [next] = remaining.splice(nearest, 1);
    if (!next) break;
    ordered.push(next);
    current = next;
  }
  return ordered.map((stop, index) => ({
    visitId: stop.id,
    driveMinutes: index === 0 ? 0 : driveMinutes(milesBetween(ordered[index - 1]!, stop)),
  }));
}

export async function quoteRoute(
  stops: RouteStop[],
  env: RoutingEnv,
  fetchImpl: FetchLike,
  source: "heuristic" | "api" = routingConfigured(env) ? "api" : "heuristic",
): Promise<RouteQuote> {
  if (source === "heuristic" || !routingConfigured(env)) {
    return { source: "heuristic", legs: optimizeRoute(stops) };
  }
  const response = await fetchImpl(env.ROUTING_API_URL!.trim(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ROUTING_API_KEY!.trim()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      stops: stops.map((stop) => ({ id: stop.id, lat: stop.lat, lng: stop.lng })),
    }),
  });
  if (!response.ok) throw new Error("Routing service did not answer");
  const body: unknown = await response.json();
  return { source: "api", legs: parseRoutingBody(body, stops) };
}

function parseRoutingBody(body: unknown, stops: RouteStop[]): RouteLeg[] {
  if (!body || typeof body !== "object") throw new Error("Routing service did not answer");
  const record = body as { order?: unknown; driveMinutes?: unknown };
  if (!Array.isArray(record.order) || !Array.isArray(record.driveMinutes)) {
    throw new Error("Routing service did not answer");
  }
  if (record.order.length !== stops.length || record.driveMinutes.length !== stops.length) {
    throw new Error("Routing service did not answer");
  }
  const expected = new Set(stops.map((stop) => stop.id));
  const legs: RouteLeg[] = [];
  for (let index = 0; index < record.order.length; index += 1) {
    const visitId = record.order[index];
    const minutes = record.driveMinutes[index];
    if (typeof visitId !== "string" || !expected.has(visitId)) throw new Error("Routing service did not answer");
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0) {
      throw new Error("Routing service did not answer");
    }
    expected.delete(visitId);
    legs.push({ visitId, driveMinutes: minutes });
  }
  if (expected.size > 0) throw new Error("Routing service did not answer");
  return legs;
}
