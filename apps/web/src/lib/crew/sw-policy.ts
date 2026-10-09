export const TILE_HOST_MARKERS = ["arcgis.com", "arcgisonline.com"] as const;

export type CachePlan = "bypass" | "cache-first" | "network-first" | "network-only";

const BUILD_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function crewCacheName(build: string | null | undefined): string {
  const id = build && BUILD_ID.test(build) ? build : "dev";
  return `crew-shell-${id}`;
}

export function crewWorkerUrl(build: string | null | undefined): string {
  return `/sw.js?build=${crewCacheName(build).slice("crew-shell-".length)}`;
}

/** Deletes every crew shell cache, including a previous deploy. */
export async function clearCrewCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("crew-shell-")).map((key) => caches.delete(key)));
}

export function cachePlan(input: {
  method: string;
  hostname: string;
  pathname: string;
  sameOrigin: boolean;
}): CachePlan {
  if (input.method !== "GET") return "bypass";
  const host = input.hostname.toLowerCase();
  if (TILE_HOST_MARKERS.some((marker) => host.includes(marker)) || host.includes("supabase")) return "bypass";
  if (!input.sameOrigin) return "bypass";
  if (
    input.pathname === "/offline.html" ||
    input.pathname === "/crew/manifest.webmanifest" ||
    input.pathname.startsWith("/icons/") ||
    input.pathname.startsWith("/_next/static/")
  ) {
    return "cache-first";
  }
  if (input.pathname === "/crew/today") return "network-first";
  if (input.pathname === "/sw.js" || input.pathname.startsWith("/crew")) return "network-only";
  return "bypass";
}

/** A crew page is stored only when the network returned this document, not a redirect. */
export function canCacheCrewPage(response: { status: number; type: string; redirected: boolean }): boolean {
  return response.status === 200 && response.type === "basic" && response.redirected !== true;
}
