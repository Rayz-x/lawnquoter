import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getWorkerUrl } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import "./maplibre-worker";

describe("maplibre worker", () => {
  it("points at the worker file shipped with maplibre-gl", () => {
    const url = getWorkerUrl();
    expect(url).toMatch(/maplibre-gl-worker\.mjs$/);
    expect(existsSync(fileURLToPath(url))).toBe(true);
  });
});
