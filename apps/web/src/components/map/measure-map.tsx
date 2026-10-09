"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { FeatureCategory, Geometry } from "@lawnquoter/shared";
import { FEATURE_COLORS, isLineCategory } from "@lawnquoter/shared";
import bbox from "@turf/bbox";
import { feature, featureCollection } from "@turf/helpers";
import {
  TerraDraw,
  TerraDrawFreehandMode,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { StudioFeature } from "@/lib/geo/features";
import { imageryStyle } from "./basemap";

export type DrawMode = "static" | "polygon" | "linestring" | "freehand" | "select" | "cut";

type Props = {
  location: Geometry | null;
  parcel: Geometry | null;
  footprint: Geometry | null;
  features: StudioFeature[];
  mode: DrawMode;
  category: FeatureCategory;
  onDrawn: (geometry: Geometry) => void;
  className?: string;
};

export function MeasureMap({ location, parcel, footprint, features, mode, category, onDrawn, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const onDrawnRef = useRef(onDrawn);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: imageryStyle(),
      center: location?.type === "Point" ? location.coordinates : [-98.5, 39.8],
      zoom: location ? 18 : 3,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const snap = { toCoordinate: true, toLine: true };
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({ snapping: snap }),
        new TerraDrawLineStringMode({ snapping: snap }),
        new TerraDrawFreehandMode(),
        new TerraDrawSelectMode({
          flags: {
            polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
            linestring: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
          },
        }),
      ],
    });
    drawRef.current = draw;

    map.on("load", () => {
      draw.start();
      draw.setMode("select");
      draw.on("finish", (id) => {
        const f = draw.getSnapshotFeature(id);
        if (!f?.geometry) return;
        onDrawnRef.current(f.geometry as Geometry);
        draw.removeFeatures([id]);
      });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onDrawnRef.current = onDrawn;
  }, [onDrawn]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw?.enabled) return;
    const next = mode === "cut" ? "polygon" : mode === "static" ? "select" : mode;
    try {
      draw.setMode(next);
    } catch {
      /* mode not ready yet */
    }
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
        else map.addSource(id, { type: "geojson", data });
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
      data-category={category}
      data-line={isLineCategory(category) ? "1" : "0"}
    />
  );
}
