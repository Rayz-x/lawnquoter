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
 * With an ArcGIS Location Platform key, World Imagery tiles are requested
 * from the basemap tile API with that token. Without a key, the public
 * World_Imagery tile service is used for development.
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

/**
 * Plain outline basemap for crew battery saver: no satellite tile requests.
 * Property outlines, pins, and drawn shapes layer on as GeoJSON after load.
 */
export function outlineStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0f1712" },
      },
    ],
  };
}

/** Crew maps pick imagery or outline from the device battery-saver toggle. */
export function crewMapStyle(batterySaver: boolean): StyleSpecification {
  return batterySaver ? outlineStyle() : imageryStyle();
}

export function styleRequestsImagery(style: StyleSpecification): boolean {
  return Object.values(style.sources).some((source) => {
    if (source.type !== "raster" || !("tiles" in source) || !source.tiles) return false;
    return source.tiles.some((url) => url.includes("World_Imagery"));
  });
}
