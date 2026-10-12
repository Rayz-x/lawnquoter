"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { imageryStyle, mapAttributionControl } from "@/components/map/basemap";

export type DensityMapPoint = { lng: number; lat: number; weight: number };

/** Visit density on the office map: a heat layer, with clusters when zoomed out. */
export function DensityMap({ points }: { points: DensityMapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: imageryStyle(),
      center: points[0] ? [points[0].lng, points[0].lat] : [-98.5, 39.8],
      zoom: points[0] ? 11 : 3,
      attributionControl: mapAttributionControl,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = {
      type: "FeatureCollection" as const,
      features: points.map((point) => ({
        type: "Feature" as const,
        properties: { weight: point.weight },
        geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] },
      })),
    };
    const apply = () => {
      const heat = map.getSource("density-heat") as maplibregl.GeoJSONSource | undefined;
      const existing = map.getSource("density") as maplibregl.GeoJSONSource | undefined;
      if (heat && existing) {
        heat.setData(data);
        existing.setData(data);
        return;
      }
      map.addSource("density-heat", { type: "geojson", data });
      map.addSource("density", { type: "geojson", data, cluster: true, clusterRadius: 40, clusterMaxZoom: 12 });
      map.addLayer({
        id: "density-heat",
        type: "heatmap",
        source: "density-heat",
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 8, 1],
          "heatmap-intensity": 1.1,
          "heatmap-radius": 28,
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.3,
            "#86efac",
            0.6,
            "#22c55e",
            1,
            "#14532d",
          ],
        },
      });
      map.addLayer({
        id: "density-clusters",
        type: "circle",
        source: "density",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#166534",
          "circle-radius": ["step", ["get", "point_count"], 14, 5, 18, 15, 24],
          "circle-opacity": 0.85,
        },
      });
      if (points.length === 0) return;
      const bounds = new maplibregl.LngLatBounds();
      for (const point of points) bounds.extend([point.lng, point.lat]);
      map.fitBounds(bounds, { padding: 40, maxZoom: 13, duration: 0 });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [points]);

  return <div ref={containerRef} className="h-80 overflow-hidden rounded-xl ring-1 ring-foreground/10" />;
}
