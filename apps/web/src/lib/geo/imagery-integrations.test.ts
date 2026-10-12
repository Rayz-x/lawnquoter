import { afterEach, describe, expect, it, vi } from "vitest";
import type { Geometry } from "@lawnquoter/shared";
import { imageryIntegrationStatus, prefillFromSegmentation } from "./imagery-integrations";

afterEach(() => {
  vi.restoreAllMocks();
});

const square: Geometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

describe("imagery integrations", () => {
  it("stays disconnected until each key is set", () => {
    expect(imageryIntegrationStatus({})).toEqual({
      nearmap: { connected: false, message: "Not connected - add NEARMAP_API_KEY to enable" },
      vexcel: { connected: false, message: "Not connected - add VEXCEL_API_KEY to enable" },
      segmentation: { connected: false, message: "Not connected - add SEGMENTATION_API_KEY to enable" },
    });
    expect(imageryIntegrationStatus({ NEARMAP_API_KEY: " secret " }).nearmap).toEqual({
      connected: true,
      message: "Nearmap key saved. HD imagery stays off.",
    });
    expect(imageryIntegrationStatus({ NEARMAP_API_KEY: " secret " }).vexcel.connected).toBe(false);
  });

  it("does not call segmentation or the network without a key", async () => {
    const client = vi.fn(async () => [{ category: "turf_front" as const, geometry: square }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await prefillFromSegmentation({ key: "  ", client });
    expect(result).toEqual({ ok: false, error: "Not connected - add SEGMENTATION_API_KEY to enable" });
    expect(client).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the injected segmentation polygons and still does not use the network", async () => {
    const client = vi.fn(async () => [{ category: "turf_front" as const, geometry: square }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await prefillFromSegmentation({ key: "secret", client });
    expect(result).toEqual({ ok: true, features: [{ category: "turf_front", geometry: square }] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays off when a key is saved but no segmentation client is installed", async () => {
    expect(await prefillFromSegmentation({ key: "secret" })).toEqual({ ok: false, error: "Segmentation stays off." });
  });
});
