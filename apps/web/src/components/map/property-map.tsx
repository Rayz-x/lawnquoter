"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { Geometry } from "@lawnquoter/shared";
import bbox from "@turf/bbox";
import { featureCollection, feature } from "@turf/helpers";
import { ESRI_GEOCODE_ATTRIBUTION, imageryStyle } from "./basemap";

export type PropertyMapProps = {
  location: Geometry | null;
  parcel: Geometry | null;
  footprint: Geometry | null;
  className?: string;
  interactive?: boolean;
};

/** Read-only property map: imagery + parcel outline + building footprint + pin. */
export function PropertyMap({ location, parcel, footprint, className, interactive = true }: PropertyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: imageryStyle(),
      center: location?.type === "Point" ? location.coordinates : [-98.5, 39.8],
      zoom: location ? 18 : 3,
      interactive,
      attributionControl: { compact: true },
    });
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; data updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const features = [];
      if (parcel) features.push(feature(parcel, { kind: "parcel" }));
      if (footprint) features.push(feature(footprint, { kind: "footprint" }));
      if (location) features.push(feature(location, { kind: "location" }));
      const fc = featureCollection(features);

      const existing = map.getSource("property") as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(fc);
      } else {
        map.addSource("property", {
          type: "geojson",
          data: fc,
          attribution: ESRI_GEOCODE_ATTRIBUTION,
        });
        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "property",
          filter: ["==", ["get", "kind"], "parcel"],
          paint: { "fill-color": "#facc15", "fill-opacity": 0.08 },
        });
        map.addLayer({
          id: "parcel-line",
          type: "line",
          source: "property",
          filter: ["==", ["get", "kind"], "parcel"],
          paint: { "line-color": "#facc15", "line-width": 2.5 },
        });
        map.addLayer({
          id: "footprint-fill",
          type: "fill",
          source: "property",
          filter: ["==", ["get", "kind"], "footprint"],
          paint: { "fill-color": "#f87171", "fill-opacity": 0.25 },
        });
        map.addLayer({
          id: "footprint-line",
          type: "line",
          source: "property",
          filter: ["==", ["get", "kind"], "footprint"],
          paint: { "line-color": "#f87171", "line-width": 2 },
        });
        map.addLayer({
          id: "location-pin",
          type: "circle",
          source: "property",
          filter: ["==", ["get", "kind"], "location"],
          paint: {
            "circle-radius": 6,
            "circle-color": "#3b82f6",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      }
      if (features.length > 0) {
        const [minX, minY, maxX, maxY] = bbox(fc);
        if (parcel || footprint) {
          map.fitBounds(
            [
              [minX, minY],
              [maxX, maxY],
            ],
            { padding: 40, maxZoom: 19.5, duration: 0 },
          );
        } else if (location?.type === "Point") {
          map.jumpTo({ center: location.coordinates, zoom: 18.5 });
        }
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [location, parcel, footprint]);

  return <div ref={containerRef} className={className ?? "h-80 w-full rounded-lg overflow-hidden"} />;
}
