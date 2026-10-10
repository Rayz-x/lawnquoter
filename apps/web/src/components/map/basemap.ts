import type { StyleSpecification } from "maplibre-gl";
import "./maplibre-worker";

/**
 * Required wherever a stored ArcGIS geocode is drawn. Esri's location-services
 * terms require the "Powered by Esri" text; the World Geocoding service
 * metadata does not add a separate data-provider string.
 */
export const ESRI_GEOCODE_ATTRIBUTION = "Powered by Esri";

/**
 * MapLibre's default attribution control is compact, which hides credits
 * behind a tap. `compact: false` keeps the geocode and imagery credits visible.
 */
export const mapAttributionControl = {
  compact: false,
  customAttribution: ESRI_GEOCODE_ATTRIBUTION,
} as const;

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
        // World Imagery often ends around z19, and missing coverage comes back
        // as a "Map data not yet available" image. Stop there so MapLibre
        // scales the last real tile. The map's own max zoom stays higher.
        maxzoom: 19,
        attribution:
          "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      },
    },
    layers: [{ id: "imagery", type: "raster", source: "imagery" }],
  };
}
