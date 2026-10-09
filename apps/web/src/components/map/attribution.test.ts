import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ESRI_GEOCODE_ATTRIBUTION } from "./basemap";

describe("Esri geocode attribution", () => {
  it("uses the Powered by Esri text on maps that draw a stored geocode", () => {
    expect(ESRI_GEOCODE_ATTRIBUTION).toBe("Powered by Esri");
    for (const file of ["property-map.tsx", "measure-map.tsx"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).toContain("ESRI_GEOCODE_ATTRIBUTION");
      expect(source).not.toMatch(/Google|googleapis/);
    }
  });
});
