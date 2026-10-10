"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { parseDayPack, type DayStop } from "@/app/(crew)/crew/today";
import { crewMapStyle, mapAttributionControl } from "@/components/map/basemap";
import { readBatterySaver, subscribeBatterySaver } from "@/lib/crew/battery-saver";
import { planOutlineFeatures, visitPinFeatures, visitPinPaint } from "@/lib/crew/map-overlays";
import { browserCrewStore, loadDayPack } from "@/lib/crew/queue";

export function CrewDayMap({ date }: { date: string }) {
  const batterySaver = useSyncExternalStore(subscribeBatterySaver, () => readBatterySaver(localStorage), () => false);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [stops, setStops] = useState<DayStop[]>([]);
  const [planVisits, setPlanVisits] = useState<unknown[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const styleKey = batterySaver ? "outline" : "imagery";
  const showMap = batterySaver || online;

  useEffect(() => {
    let stop = false;
    void loadDayPack(browserCrewStore(), date).then((row) => {
      if (stop) return;
      const pack = row?.pack;
      const view = pack ? parseDayPack(pack) : null;
      setStops(view?.stops ?? []);
      const visits = pack && typeof pack === "object" && Array.isArray((pack as { visits?: unknown }).visits)
        ? ((pack as { visits: unknown[] }).visits)
        : [];
      setPlanVisits(visits);
    });
    return () => {
      stop = true;
    };
  }, [date]);

  useEffect(() => {
    if (!showMap || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: crewMapStyle(batterySaver),
      center: [-98.5, 39.8],
      zoom: 3,
      attributionControl: mapAttributionControl,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [showMap, styleKey, batterySaver]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showMap) return;
    const apply = () => {
      const pins = visitPinFeatures(stops);
      const outlines = planOutlineFeatures(planVisits);

      const outlineSource = map.getSource("plan") as maplibregl.GeoJSONSource | undefined;
      if (outlineSource) {
        outlineSource.setData(outlines);
      } else {
        map.addSource("plan", { type: "geojson", data: outlines });
        map.addLayer({
          id: "plan-fill",
          type: "fill",
          source: "plan",
          paint: { "fill-color": "#C8891C", "fill-opacity": 0.18 },
        });
        map.addLayer({
          id: "plan-line",
          type: "line",
          source: "plan",
          paint: { "line-color": "#C8891C", "line-width": 2 },
        });
      }

      const pinSource = map.getSource("visits") as maplibregl.GeoJSONSource | undefined;
      if (pinSource) {
        pinSource.setData(pins);
      } else {
        map.addSource("visits", { type: "geojson", data: pins });
        map.addLayer({
          id: "visit-pins",
          type: "circle",
          source: "visits",
          paint: visitPinPaint() as maplibregl.CircleLayerSpecification["paint"],
        });
      }

      const bounds = new maplibregl.LngLatBounds();
      let hasBounds = false;
      for (const feature of outlines.features) {
        const coords = geometryPoints(feature.geometry);
        for (const point of coords) {
          bounds.extend(point);
          hasBounds = true;
        }
      }
      for (const feature of pins.features) {
        bounds.extend(feature.geometry.coordinates);
        hasBounds = true;
      }
      if (hasBounds) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: batterySaver ? 0 : 300 });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [stops, planVisits, showMap, styleKey, batterySaver]);

  if (!showMap) {
    return (
      <section className="px-4 pt-[max(1rem,env(safe-area-inset-top,0px))]">
        <h1 className="text-2xl font-bold">Map</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Map needs signal.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-2">
        <h1 className="text-2xl font-bold">Map</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {batterySaver ? "Battery saver · outline map, no satellite tiles." : "Today's stops."}{" "}
          <Link href="/crew/me" className="font-semibold text-primary">
            Settings
          </Link>
        </p>
      </header>
      <div ref={containerRef} className="min-h-[70vh] w-full flex-1" />
    </section>
  );
}

function geometryPoints(geometry: GeoJSON.Geometry): [number, number][] {
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap(geometryPoints);
  }
  return flattenCoordinates(geometry.coordinates);
}

function flattenCoordinates(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    return [[value[0], value[1]]];
  }
  return value.flatMap((item) => flattenCoordinates(item));
}

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}
