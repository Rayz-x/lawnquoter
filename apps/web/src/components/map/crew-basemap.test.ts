import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { crewMapStyle, outlineStyle, styleRequestsImagery } from "./basemap";
import { planOutlineFeatures, visitPinFeatures } from "@/lib/crew/map-overlays";

function tileUrls(style: StyleSpecification): string[] {
  return Object.values(style.sources).flatMap((source) => {
    if (source.type !== "raster" || !("tiles" in source) || !source.tiles) return [];
    return source.tiles;
  });
}

describe("crew battery-saver basemap", () => {
  it("requests no imagery tiles when battery saver is on", () => {
    const style = crewMapStyle(true);
    expect(styleRequestsImagery(style)).toBe(false);
    expect(tileUrls(style)).toEqual([]);
    expect(JSON.stringify(style)).not.toMatch(/World_Imagery/);
  });

  it("keeps the Esri imagery basemap when battery saver is off", () => {
    const style = crewMapStyle(false);
    expect(styleRequestsImagery(style)).toBe(true);
    expect(tileUrls(style).some((url) => url.includes("World_Imagery"))).toBe(true);
  });

  it("still exposes a map style that can host property outlines and visit pins", () => {
    const style = outlineStyle();
    expect(style.version).toBe(8);
    expect(style.layers.some((layer) => layer.type === "background")).toBe(true);

    const pins = visitPinFeatures([
      { id: "v1", number: 1, lat: 40.1, lng: -89.2, status: "scheduled" },
      { id: "v2", number: 2, lat: null, lng: null, status: "scheduled" },
    ]);
    expect(pins.features).toHaveLength(1);
    expect(pins.features[0]).toMatchObject({
      geometry: { type: "Point", coordinates: [-89.2, 40.1] },
      properties: { kind: "visit-pin", number: 1, status: "scheduled" },
    });

    const outlines = planOutlineFeatures([
      {
        plan: [
          {
            category: "turf",
            label: "Front",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-89.2, 40.1],
                  [-89.19, 40.1],
                  [-89.19, 40.11],
                  [-89.2, 40.11],
                  [-89.2, 40.1],
                ],
              ],
            },
          },
        ],
      },
    ]);
    expect(outlines.features).toHaveLength(1);
    expect(outlines.features[0]?.properties).toMatchObject({ kind: "plan-outline", category: "turf" });
  });
});
