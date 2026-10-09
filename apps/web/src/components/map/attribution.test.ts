import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ESRI_GEOCODE_ATTRIBUTION, mapAttributionControl } from "./basemap";

describe("Esri geocode attribution", () => {
  it("keeps Powered by Esri expanded on maps that draw a stored geocode", () => {
    expect(ESRI_GEOCODE_ATTRIBUTION).toBe("Powered by Esri");
    expect(mapAttributionControl).toEqual({
      compact: false,
      customAttribution: "Powered by Esri",
    });
    for (const file of ["property-map.tsx", "measure-map.tsx"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).toContain("mapAttributionControl");
      expect(source).not.toContain("compact: true");
    }
  });
});
