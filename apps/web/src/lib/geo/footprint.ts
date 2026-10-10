import "server-only";

import type { MultiPolygon, Polygon, Position } from "@lawnquoter/shared";
import { pointInRing } from "./geometry";
import type { FootprintResult } from "./types";

/**
 * Building footprint lookup. Live source is OpenStreetMap via Overpass (free, ODbL).
 */
export async function lookupFootprint(lng: number, lat: number, radiusM = 40): Promise<FootprintResult | null> {
  const endpoint = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
  const query = `[out:json][timeout:15];
    (
      way["building"](around:${radiusM},${lat},${lng});
      relation["building"]["type"="multipolygon"](around:${radiusM},${lat},${lng});
    );
    out geom;`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(16_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as {
    elements?: Array<
      | { type: "way"; geometry?: Array<{ lat: number; lon: number }>; tags?: Record<string, string> }
      | {
          type: "relation";
          members?: Array<{ role: string; geometry?: Array<{ lat: number; lon: number }> }>;
          tags?: Record<string, string>;
        }
    >;
  };

  const polygons: Polygon[] = [];
  for (const el of json.elements ?? []) {
    if (el.type === "way" && el.geometry && el.geometry.length >= 4) {
      const ring: Position[] = el.geometry.map((p) => [p.lon, p.lat]);
      if (!samePoint(ring[0]!, ring[ring.length - 1]!)) ring.push(ring[0]!);
      polygons.push({ type: "Polygon", coordinates: [ring] });
    } else if (el.type === "relation") {
      const outer = (el.members ?? []).filter((m) => m.role === "outer" && m.geometry && m.geometry.length >= 4);
      for (const m of outer) {
        const ring: Position[] = m.geometry!.map((p) => [p.lon, p.lat]);
        if (!samePoint(ring[0]!, ring[ring.length - 1]!)) ring.push(ring[0]!);
        polygons.push({ type: "Polygon", coordinates: [ring] });
      }
    }
  }
  if (polygons.length === 0) return null;

  // Prefer the footprint that contains the geocoded point; else the nearest centroid.
  const containing = polygons.find((p) => pointInRing([lng, lat], p.coordinates[0]!));
  const chosen =
    containing ??
    polygons
      .map((p) => ({ p, d: dist2([lng, lat], centroid(p.coordinates[0]!)) }))
      .sort((a, b) => a.d - b.d)[0]!.p;

  const geometry: MultiPolygon = { type: "MultiPolygon", coordinates: [chosen.coordinates] };
  return { geometry, source: "osm" };
}

function samePoint(a: Position, b: Position) {
  return a[0] === b[0] && a[1] === b[1];
}

function centroid(ring: Position[]): Position {
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) {
    x += px;
    y += py;
  }
  return [x / ring.length, y / ring.length];
}

function dist2(a: Position, b: Position) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

