import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TILE_HOST_MARKERS, cachePlan } from "./sw-policy";

const worker = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

describe("cachePlan", () => {
  it("leaves map tiles and other origins uncached", () => {
    expect(cachePlan({ method: "GET", hostname: "server.arcgisonline.com", pathname: "/tile", sameOrigin: false })).toBe("bypass");
    expect(cachePlan({ method: "GET", hostname: "ibasemaps-api.arcgis.com", pathname: "/tile", sameOrigin: false })).toBe("bypass");
    expect(cachePlan({ method: "GET", hostname: "abc.supabase.co", pathname: "/rest/v1/visits", sameOrigin: false })).toBe("bypass");
    expect(cachePlan({ method: "POST", hostname: "localhost", pathname: "/crew/today", sameOrigin: true })).toBe("bypass");
  });

  it("caches static files first and the crew shell from the network", () => {
    expect(cachePlan({ method: "GET", hostname: "localhost", pathname: "/icons/icon-192.png", sameOrigin: true })).toBe("cache-first");
    expect(cachePlan({ method: "GET", hostname: "localhost", pathname: "/_next/static/media/font.woff2", sameOrigin: true })).toBe("cache-first");
    expect(cachePlan({ method: "GET", hostname: "localhost", pathname: "/crew/today", sameOrigin: true })).toBe("network-first");
    expect(cachePlan({ method: "GET", hostname: "localhost", pathname: "/dashboard", sameOrigin: true })).toBe("bypass");
  });

  it("keeps the same tile hosts out of the service worker", () => {
    for (const marker of TILE_HOST_MARKERS) expect(worker).toContain(marker);
    expect(worker).toContain("supabase");
    expect(worker).not.toMatch(/serwist|workbox|dexie/i);
  });
});
