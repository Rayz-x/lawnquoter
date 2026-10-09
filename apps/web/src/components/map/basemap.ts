import type { StyleSpecification } from "maplibre-gl";

/**
 * Esri World Imagery is the measurement canvas: Esri's terms permit tracing
 * features from it to create vector data. Google/Mapbox satellite do not.
 *
 * With an ArcGIS Location Platform key we load the official imagery basemap
 * style (sessions pricing, hybrid labels). Without a key we fall back to the
 * public World_Imagery tile service for development.
 */
export function imageryStyle(): StyleSpecification {
  const key = process.env.NEXT_PUBLIC_ARCGIS_API_KEY;
  const tiles = key
    ? [
        `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${key}`,
      ]
    : ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"];
  return {
    version: 8,
    sources: {
      imagery: {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom: 20,
        attribution:
          "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      },
    },
    layers: [{ id: "imagery", type: "raster", source: "imagery" }],
  };
}
