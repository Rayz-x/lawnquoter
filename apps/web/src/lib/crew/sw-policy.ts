export const TILE_HOST_MARKERS = ["arcgis.com", "arcgisonline.com"] as const;

export type CachePlan = "bypass" | "cache-first" | "network-first";

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
  if (input.pathname.startsWith("/icons/") || input.pathname.startsWith("/_next/static/")) return "cache-first";
  if (input.pathname === "/sw.js" || input.pathname.startsWith("/crew")) return "network-first";
  return "bypass";
}
