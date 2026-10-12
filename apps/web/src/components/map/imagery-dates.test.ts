import { describe, expect, it } from "vitest";
import { imageryStyle } from "./basemap";
import { imageryChoiceForDate, waybackTileUrl } from "./imagery-dates";

describe("imagery dates", () => {
  it("uses the live World Imagery mosaic when no archive date is chosen", () => {
    expect(imageryChoiceForDate(null).id).toBe("latest");
    expect(imageryChoiceForDate("1999-01-01").id).toBe("latest");
    const tiles = imageryStyle().sources.imagery;
    expect(tiles).toMatchObject({ type: "raster" });
    if (tiles?.type !== "raster" || !("tiles" in tiles)) throw new Error("expected raster tiles");
    expect(tiles.tiles?.[0]).toContain("World_Imagery");
    expect(tiles.tiles?.[0]).not.toContain("wayback.maptiles");
  });

  it("loads the Jun 6, 2024 Wayback release", () => {
    const choice = imageryChoiceForDate("2024-06-06");
    expect(choice.release).toBe(12428);
    expect(waybackTileUrl(12428)).toBe(
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/12428/{z}/{y}/{x}",
    );
    const tiles = imageryStyle(choice.release).sources.imagery;
    if (tiles?.type !== "raster" || !("tiles" in tiles)) throw new Error("expected raster tiles");
    expect(tiles.tiles?.[0]).toContain("/tile/12428/{z}/{y}/{x}");
  });
});
