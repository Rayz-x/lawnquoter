"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import type { Map as MlMap, MapLayerMouseEvent } from "maplibre-gl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { parseDayPack, type DayStop } from "@/app/(crew)/crew/today";
import { crewMapStyle, mapAttributionControl } from "@/components/map/basemap";
import { readBatterySaver, subscribeBatterySaver } from "@/lib/crew/battery-saver";
import {
  planOutlineFeatures,
  planOutlinePaint,
  visitPinFeatures,
  visitPinHitPaint,
  visitPinLabelLayout,
  visitPinLabelPaint,
  visitPinPaint,
  VISIT_PIN_HIT_LAYER,
  VISIT_PIN_LABEL_LAYER,
  VISIT_PIN_LAYER,
} from "@/lib/crew/map-overlays";
import { readMapTokens, type MapTokens } from "@/lib/crew/map-tokens";
import { browserCrewStore, loadDayPack } from "@/lib/crew/queue";

export function CrewDayMap({ date }: { date: string }) {
  const router = useRouter();
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
    const tokens = readMapTokens(crewThemeRoot(containerRef.current));
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: crewMapStyle(batterySaver, tokens.background),
      center: [-98.5, 39.8],
      zoom: 3,
      attributionControl: mapAttributionControl,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const openStop = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string" && id) router.push(`/crew/visits/${id}`);
    };
    const setPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("click", VISIT_PIN_HIT_LAYER, openStop);
    map.on("mouseenter", VISIT_PIN_HIT_LAYER, setPointer);
    map.on("mouseleave", VISIT_PIN_HIT_LAYER, clearPointer);

    return () => {
      map.off("click", VISIT_PIN_HIT_LAYER, openStop);
      map.off("mouseenter", VISIT_PIN_HIT_LAYER, setPointer);
      map.off("mouseleave", VISIT_PIN_HIT_LAYER, clearPointer);
      map.remove();
      mapRef.current = null;
    };
  }, [showMap, styleKey, batterySaver, router]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showMap) return;
    const apply = () => {
      const tokens = readMapTokens(crewThemeRoot(containerRef.current));
      const pins = visitPinFeatures(stops);
      const outlines = planOutlineFeatures(planVisits);
      const outlinePaint = planOutlinePaint(tokens);

      const outlineSource = map.getSource("plan") as maplibregl.GeoJSONSource | undefined;
      if (outlineSource) {
        outlineSource.setData(outlines);
      } else {
        map.addSource("plan", { type: "geojson", data: outlines });
        map.addLayer({
          id: "plan-fill",
          type: "fill",
          source: "plan",
          paint: outlinePaint.fill,
        });
        map.addLayer({
          id: "plan-line",
          type: "line",
          source: "plan",
          paint: outlinePaint.line,
        });
      }

      const pinSource = map.getSource("visits") as maplibregl.GeoJSONSource | undefined;
      if (pinSource) {
        pinSource.setData(pins);
        setPinPaint(map, tokens);
      } else {
        map.addSource("visits", { type: "geojson", data: pins });
        map.addLayer({
          id: VISIT_PIN_HIT_LAYER,
          type: "circle",
          source: "visits",
          paint: visitPinHitPaint() as maplibregl.CircleLayerSpecification["paint"],
        });
        map.addLayer({
          id: VISIT_PIN_LAYER,
          type: "circle",
          source: "visits",
          paint: visitPinPaint(tokens) as maplibregl.CircleLayerSpecification["paint"],
        });
        map.addLayer({
          id: VISIT_PIN_LABEL_LAYER,
          type: "symbol",
          source: "visits",
          layout: visitPinLabelLayout() as maplibregl.SymbolLayerSpecification["layout"],
          paint: visitPinLabelPaint(tokens) as maplibregl.SymbolLayerSpecification["paint"],
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
            Me
          </Link>
        </p>
      </header>
      <div ref={containerRef} className="min-h-[70vh] w-full flex-1" />
    </section>
  );
}

function setPinPaint(map: MlMap, tokens: MapTokens) {
  if (map.getLayer(VISIT_PIN_LAYER)) {
    const paint = visitPinPaint(tokens);
    map.setPaintProperty(
      VISIT_PIN_LAYER,
      "circle-color",
      paint["circle-color"] as maplibregl.DataDrivenPropertyValueSpecification<string>,
    );
    map.setPaintProperty(VISIT_PIN_LAYER, "circle-stroke-color", paint["circle-stroke-color"]);
  }
  if (map.getLayer(VISIT_PIN_LABEL_LAYER)) {
    map.setPaintProperty(VISIT_PIN_LABEL_LAYER, "text-color", visitPinLabelPaint(tokens)["text-color"]);
  }
}

/** Prefer the crew shell theme node so Sun / dark tokens apply to the outline map. */
export function crewThemeRoot(from: Element | null): Element {
  let node: Element | null = from;
  while (node) {
    if (
      node.classList.contains("sun") ||
      node.classList.contains("crew-display-light") ||
      node.classList.contains("crew-battery-saver") ||
      (node.classList.contains("dark") && node !== document.documentElement)
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return document.documentElement;
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
