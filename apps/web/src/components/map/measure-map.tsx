"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { FeatureCategory, Geometry } from "@lawnquoter/shared";
import { FEATURE_COLORS } from "@lawnquoter/shared";
import bbox from "@turf/bbox";
import { feature, featureCollection } from "@turf/helpers";
import { TerraDraw } from "terra-draw";
import type { StudioFeature } from "@/lib/geo/features";
import { ESRI_GEOCODE_ATTRIBUTION, imageryStyle, mapAttributionControl } from "./basemap";
import { MeasureDrawAdapter, applyMeasureTool, createMeasureDrawModes, type DrawMode } from "./measure-gestures";

export type { DrawMode };

type Props = {
  location: Geometry | null;
  parcel: Geometry | null;
  footprint: Geometry | null;
  features: StudioFeature[];
  mode: DrawMode;
  onDrawn: (geometry: Geometry) => void;
  className?: string;
};

export function MeasureMap({ location, parcel, footprint, features, mode, onDrawn, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const adapterRef = useRef<MeasureDrawAdapter | null>(null);
  const modeRef = useRef(mode);
  const onDrawnRef = useRef(onDrawn);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: imageryStyle(),
      center: location?.type === "Point" ? location.coordinates : [-98.5, 39.8],
      zoom: location ? 18 : 3,
      attributionControl: mapAttributionControl,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const adapter = new MeasureDrawAdapter(map);
    adapterRef.current = adapter;
    const draw = new TerraDraw({
      adapter,
      modes: createMeasureDrawModes(),
    });
    drawRef.current = draw;

    map.on("load", () => {
      draw.start();
      draw.on("finish", (id) => {
        const f = draw.getSnapshotFeature(id);
        if (!f?.geometry) return;
        onDrawnRef.current(f.geometry as Geometry);
        draw.removeFeatures([id]);
      });
      const current = adapterRef.current;
      if (current) applyMeasureTool(draw, current, modeRef.current);
    });

    return () => {
      try {
        draw.stop();
      } catch {
        /* already stopped */
      }
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
      adapterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onDrawnRef.current = onDrawn;
  }, [onDrawn]);

  useEffect(() => {
    modeRef.current = mode;
    const draw = drawRef.current;
    const adapter = adapterRef.current;
    if (!draw || !adapter) return;
    applyMeasureTool(draw, adapter, mode);
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const context = [];
      if (parcel) context.push(feature(parcel, { kind: "parcel" }));
      if (footprint) context.push(feature(footprint, { kind: "footprint" }));
      if (location) context.push(feature(location, { kind: "location" }));
      const ctx = featureCollection(context);

      const drawn = featureCollection(
        features
          .filter((f) => f.geometry)
          .map((f) => feature(f.geometry!, { category: f.category, kind: "feature" })),
      );

      const set = (id: string, data: GeoJSON.FeatureCollection) => {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        else
          map.addSource(id, {
            type: "geojson",
            data,
            // The context source draws the stored geocode pin.
            ...(id === "ctx" ? { attribution: ESRI_GEOCODE_ATTRIBUTION } : {}),
          });
      };
      set("ctx", ctx);
      set("drawn", drawn);

      if (!map.getLayer("parcel-fill")) {
        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "ctx",
          filter: ["==", ["get", "kind"], "parcel"],
          paint: { "fill-color": "#facc15", "fill-opacity": 0.06 },
        });
        map.addLayer({
          id: "parcel-line",
          type: "line",
          source: "ctx",
          filter: ["==", ["get", "kind"], "parcel"],
          paint: { "line-color": "#facc15", "line-width": 2, "line-dasharray": [2, 1] },
        });
        map.addLayer({
          id: "footprint-fill",
          type: "fill",
          source: "ctx",
          filter: ["==", ["get", "kind"], "footprint"],
          paint: { "fill-color": "#f87171", "fill-opacity": 0.22 },
        });
        map.addLayer({
          id: "footprint-line",
          type: "line",
          source: "ctx",
          filter: ["==", ["get", "kind"], "footprint"],
          paint: { "line-color": "#f87171", "line-width": 2 },
        });
        map.addLayer({
          id: "location-pin",
          type: "circle",
          source: "ctx",
          filter: ["==", ["get", "kind"], "location"],
          paint: { "circle-radius": 5, "circle-color": "#3b82f6", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
        });
        map.addLayer({
          id: "drawn-fill",
          type: "fill",
          source: "drawn",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 },
        });
        map.addLayer({
          id: "drawn-line",
          type: "line",
          source: "drawn",
          paint: { "line-color": ["get", "color"], "line-width": 2.5 },
        });
      }

      const colored = featureCollection(
        drawn.features.map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            color: FEATURE_COLORS[(f.properties?.category as FeatureCategory) ?? "turf_front"],
          },
        })),
      );
      (map.getSource("drawn") as maplibregl.GeoJSONSource | undefined)?.setData(colored);

      if ((parcel || footprint) && !fittedRef.current) {
        const [minX, minY, maxX, maxY] = bbox(ctx);
        map.fitBounds(
          [
            [minX, minY],
            [maxX, maxY],
          ],
          { padding: 48, maxZoom: 19.5, duration: 0 },
        );
        fittedRef.current = true;
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [location, parcel, footprint, features]);

  return (
    <div
      ref={containerRef}
      className={className}
    />
  );
}
