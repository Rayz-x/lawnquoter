import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { TILE_HOST_MARKERS, cachePlan, crewCacheName, crewWorkerUrl, type CachePlan } from "./sw-policy";

const worker = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
const buildId = worker.slice(worker.indexOf("const BUILD_ID"), worker.indexOf("const ICONS"));
const nameFn = worker.slice(worker.indexOf("function crewCacheName"), worker.indexOf("const CACHE"));
const planFn = worker.slice(worker.indexOf("function cachePlan"), worker.indexOf("function cacheFirst"));

function runWorker(source: string, sandbox: Record<string, unknown>) {
  return runInNewContext(source, { self: { location: { origin: "https://crew.example" } }, ...sandbox });
}

function workerPlan(method: string, hostname: string, pathname: string, sameOrigin: boolean): CachePlan {
  const url = {
    hostname,
    pathname,
    origin: sameOrigin ? "https://crew.example" : `https://${hostname}`,
  };
  return runWorker(`${planFn}\ncachePlan(url, method)`, { url, method });
}

const CASES: Array<[string, string, string, boolean]> = [
  ["GET", "server.arcgisonline.com", "/tile", false],
  ["GET", "ibasemaps-api.arcgis.com", "/tile", false],
  ["GET", "abc.supabase.co", "/rest/v1/visits", false],
  ["POST", "localhost", "/crew/today", true],
  ["GET", "localhost", "/icons/icon-192.png", true],
  ["GET", "localhost", "/_next/static/media/font.woff2", true],
  ["GET", "localhost", "/offline.html", true],
  ["GET", "localhost", "/crew/manifest.webmanifest", true],
  ["GET", "localhost", "/crew/today", true],
  ["GET", "localhost", "/sw.js", true],
  ["GET", "localhost", "/dashboard", true],
];

describe("cachePlan", () => {
  it("runs the same rules in the service worker and the module", () => {
    for (const [method, hostname, pathname, sameOrigin] of CASES) {
      const expected = cachePlan({ method, hostname, pathname, sameOrigin });
      expect(workerPlan(method, hostname, pathname, sameOrigin), pathname).toBe(expected);
    }
    expect(cachePlan({ method: "GET", hostname: "localhost", pathname: "/crew/today", sameOrigin: true })).toBe("network-only");
    expect(cachePlan({ method: "GET", hostname: "localhost", pathname: "/offline.html", sameOrigin: true })).toBe("cache-first");
  });

  it("precaches a public offline page and versions the cache per deploy", () => {
    expect(worker).toContain('"/offline.html"');
    expect(worker).not.toContain('"/crew/today"');
    expect(worker).not.toContain("network-first");
    expect(runWorker(`${buildId}\n${nameFn}\ncrewCacheName(build)`, { build: "abc123" })).toBe(crewCacheName("abc123"));
    expect(runWorker(`${buildId}\n${nameFn}\ncrewCacheName(build)`, { build: "../x" })).toBe("crew-shell-dev");
    expect(crewWorkerUrl("abc123")).toBe("/sw.js?build=abc123");
    for (const marker of TILE_HOST_MARKERS) expect(worker).toContain(marker);
    expect(worker).not.toMatch(/serwist|workbox|dexie/i);
  });
});
