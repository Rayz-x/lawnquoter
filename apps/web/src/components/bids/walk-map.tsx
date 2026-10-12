"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { imageryStyle, mapAttributionControl } from "@/components/map/basemap";
import type { WalkPin } from "@/lib/bids/walk";

/** Site-walk notes pinned on imagery. */
export function WalkMap({ pins }: { pins: WalkPin[] }) {
  if (pins.length === 0) return null;
  return <WalkMapCanvas pins={pins} />;
}
function WalkMapCanvas({ pins }: { pins: WalkPin[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const startLng = pins[0]?.lng;
  const startLat = pins[0]?.lat;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || startLng == null || startLat == null) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: imageryStyle(),
      center: [startLng, startLat],
      zoom: 16,
      attributionControl: mapAttributionControl,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [startLng, startLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = {
      type: "FeatureCollection" as const,
      features: pins.map((pin) => ({
        type: "Feature" as const,
        properties: { body: pin.body },
        geometry: { type: "Point" as const, coordinates: [pin.lng, pin.lat] },
      })),
    };
    const apply = () => {
      const existing = map.getSource("walk-notes") as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource("walk-notes", { type: "geojson", data });
        map.addLayer({
          id: "walk-pins",
          type: "circle",
          source: "walk-notes",
          paint: { "circle-color": "#facc15", "circle-radius": 8, "circle-stroke-width": 2, "circle-stroke-color": "#14532d" },
        });
        map.on("click", "walk-pins", (event) => {
          const body = event.features?.[0]?.properties?.body;
          if (!body) return;
          new maplibregl.Popup({ closeButton: false }).setLngLat(event.lngLat).setText(String(body)).addTo(map);
        });
      }
      if (pins.length === 0) return;
      const bounds = new maplibregl.LngLatBounds();
      for (const pin of pins) bounds.extend([pin.lng, pin.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 17, duration: 0 });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [pins]);

  return <div ref={containerRef} className="h-64 overflow-hidden rounded-xl ring-1 ring-foreground/10" />;
}
