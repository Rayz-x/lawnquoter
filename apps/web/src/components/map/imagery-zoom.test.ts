import { describe, expect, it } from "vitest";
import { imageryStyle } from "./basemap";

describe("imagery raster max zoom", () => {
  it("stops at level 19 so MapLibre overzooms instead of loading Esri placeholder tiles", () => {
    expect(imageryStyle().sources.imagery).toMatchObject({
      type: "raster",
      maxzoom: 19,
    });
  });
});
