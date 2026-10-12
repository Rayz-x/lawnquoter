import { describe, expect, it } from "vitest";
import { parseTakeoff } from "./takeoff";

const polygon = {
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

describe("takeoff import", () => {
  it("reads a GeoJSON polygon as an imported turf area", () => {
    const result = parseTakeoff(
      JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { category: "turf_front" }, geometry: polygon }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      features: [{ category: "turf_front", source: "imported", geometry: polygon, area_sqft: null, length_ft: null }],
    });
  });

  it("reads a spreadsheet row of square feet", () => {
    const result = parseTakeoff("category,area_sqft\nturf_front,4000\n");
    expect(result).toEqual({
      ok: true,
      features: [{ category: "turf_front", source: "imported", geometry: null, area_sqft: 4000, length_ft: null }],
    });
  });

  it("keeps a thousands separator inside a quoted spreadsheet cell", () => {
    const result = parseTakeoff('category,area_sqft\nturf_front,"4,000"\n');
    expect(result.ok && result.features[0]?.area_sqft).toBe(4000);
  });

  it("rejects a file with no usable rows", () => {
    expect(parseTakeoff("category,area_sqft\nnope,12\n")).toEqual({
      ok: false,
      error: "No takeoff features found. Use a GeoJSON file, or a CSV with category and area_sqft.",
    });
  });
});
