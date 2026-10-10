import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { crewMapStyle, outlineStyle, styleRequestsImagery } from "./basemap";
import {
  planOutlineFeatures,
  visitPinFeatures,
  visitPinHitPaint,
  visitPinLabelLayout,
  visitPinPaint,
} from "@/lib/crew/map-overlays";
import type { MapTokens } from "@/lib/crew/map-tokens";

function tileUrls(style: StyleSpecification): string[] {
  return Object.values(style.sources).flatMap((source) => {
    if (source.type !== "raster" || !("tiles" in source) || !source.tiles) return [];
    return source.tiles;
  });
}

const tokens: MapTokens = {
  brass: "var-brass",
  primary: "var-primary",
  mutedForeground: "var-muted",
  background: "var-bg",
  foreground: "var-fg",
  pinLabel: "var-label",
};

describe("crew battery-saver basemap", () => {
  it("requests no imagery tiles when battery saver is on", () => {
    const style = crewMapStyle(true, "oklch(0.179 0.011 163.4)");
    expect(styleRequestsImagery(style)).toBe(false);
    expect(tileUrls(style)).toEqual([]);
    expect(JSON.stringify(style)).not.toMatch(/World_Imagery/);
  });

  it("keeps the Esri imagery basemap when battery saver is off", () => {
    const style = crewMapStyle(false, "oklch(1 0 none)");
    expect(styleRequestsImagery(style)).toBe(true);
    expect(tileUrls(style).some((url) => url.includes("World_Imagery"))).toBe(true);
  });

  it("uses the supplied background colour for the outline basemap", () => {
    const dark = outlineStyle("oklch(0.179 0.011 163.4)");
    const light = outlineStyle("oklch(1 0 none)");
    const darkBg = dark.layers.find((layer) => layer.type === "background");
    const lightBg = light.layers.find((layer) => layer.type === "background");
    expect(darkBg && "paint" in darkBg ? darkBg.paint?.["background-color"] : null).toBe("oklch(0.179 0.011 163.4)");
    expect(lightBg && "paint" in lightBg ? lightBg.paint?.["background-color"] : null).toBe("oklch(1 0 none)");
  });

  it("still exposes a map style that can host property outlines and visit pins", () => {
    const style = outlineStyle("oklch(0.179 0.011 163.4)");
    expect(style.version).toBe(8);
    expect(style.glyphs).toContain("fonts.openmaptiles.org/{fontstack}/{range}.pbf");
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

  it("paints numbered pins from Groundwork tokens with a 48px hit target", () => {
    const paint = visitPinPaint(tokens);
    expect(paint["circle-radius"]).toBe(14);
    expect(paint["circle-color"]).toEqual([
      "match",
      ["get", "status"],
      "completed",
      "var-muted",
      "in_progress",
      "var-primary",
      "paused",
      "var-primary",
      "var-brass",
    ]);
    expect(paint["circle-stroke-color"]).toBe("var-label");
    expect(visitPinHitPaint()["circle-radius"]).toBe(24);
    expect(visitPinLabelLayout()["text-field"]).toEqual(["get", "number"]);
    expect(visitPinLabelLayout()["text-size"]).toBe(14);
  });
});
