import { describe, expect, it } from "vitest";
import {
  PAID_ROUTING_HINT,
  driveMinutes,
  milesBetween,
  optimizeRoute,
  quoteRoute,
  routingConfigured,
  type RouteStop,
} from "./route-optimize";

const start: RouteStop = { id: "a", lat: 36, lng: -87 };
const north: RouteStop = { id: "b", lat: 36.2, lng: -87 };
const east: RouteStop = { id: "c", lat: 36, lng: -86.8 };

describe("drive time estimate", () => {
  it("treats one degree of latitude as a 166 minute drive at 25 mph", () => {
    const miles = milesBetween({ lat: 36, lng: -87 }, { lat: 37, lng: -87 });
    expect(miles).toBeGreaterThan(69);
    expect(miles).toBeLessThan(69.2);
    expect(driveMinutes(miles)).toBe(166);
  });

  it("orders the nearer east stop before the north stop", () => {
    expect(optimizeRoute([start, north, east])).toEqual([
      { visitId: "a", driveMinutes: 0 },
      { visitId: "c", driveMinutes: 27 },
      { visitId: "b", driveMinutes: 43 },
    ]);
  });

  it("leaves a single stop with no drive", () => {
    expect(optimizeRoute([start])).toEqual([{ visitId: "a", driveMinutes: 0 }]);
  });

  it("refuses a duplicated stop", () => {
    expect(() => optimizeRoute([start, { ...north, id: "a" }])).toThrow("duplicate stop");
  });
});

describe("paid routing", () => {
  it("stays on the free estimate when the key is missing", async () => {
    expect(routingConfigured({})).toBe(false);
    expect(PAID_ROUTING_HINT).toContain("ROUTING_API_KEY");
    const quote = await quoteRoute([start, north, east], {}, unusedFetch, "api");
    expect(quote.source).toBe("heuristic");
    expect(quote.legs.map((leg) => leg.visitId)).toEqual(["a", "c", "b"]);
  });

  it("stores the paid service order when both the url and key are set", async () => {
    const env = { ROUTING_API_URL: "https://routing.example/v1", ROUTING_API_KEY: "secret" };
    expect(routingConfigured(env)).toBe(true);
    let sent: { url: string; authorization: string } | null = null;
    const quote = await quoteRoute([start, east], env, async (url, init) => {
      sent = { url, authorization: init.headers.authorization };
      return new Response(JSON.stringify({ order: ["c", "a"], driveMinutes: [6, 11] }), { status: 200 });
    });
    expect(sent).toEqual({
      url: "https://routing.example/v1",
      authorization: "Bearer secret",
    });
    expect(quote).toEqual({
      source: "api",
      legs: [
        { visitId: "c", driveMinutes: 6 },
        { visitId: "a", driveMinutes: 11 },
      ],
    });
  });

  it("refuses a paid answer that drops a stop", async () => {
    const env = { ROUTING_API_URL: "https://routing.example/v1", ROUTING_API_KEY: "secret" };
    await expect(
      quoteRoute([start, east], env, async () => new Response(JSON.stringify({ order: ["a"], driveMinutes: [0] }), { status: 200 })),
    ).rejects.toThrow("Routing service did not answer");
  });
});

function unusedFetch(): Promise<Response> {
  throw new Error("fetch should not run");
}
