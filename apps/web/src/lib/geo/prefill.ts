import type { FeatureCategory, Geometry, MultiPolygon, Point, Polygon } from "@lawnquoter/shared";
import difference from "@turf/difference";
import intersect from "@turf/intersect";
import centroid from "@turf/centroid";
import { feature, featureCollection, polygon } from "@turf/helpers";

export type PrefillFeature = {
  category: FeatureCategory;
  geometry: MultiPolygon;
  source: "auto";
};

function asPolygonFeature(geom: Polygon | MultiPolygon) {
  return feature(geom as never);
}

function toMulti(geom: { type: string; coordinates: unknown }): MultiPolygon {
  if (geom.type === "MultiPolygon") return geom as MultiPolygon;
  return { type: "MultiPolygon", coordinates: [geom.coordinates] as MultiPolygon["coordinates"] };
}

function spanDeg(geom: Polygon | MultiPolygon): number {
  const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return Math.max(maxX - minX, maxY - minY);
}

function halfPlane(center: [number, number], toward: [number, number], radiusDeg = 0.02): Polygon {
  const dx = toward[0] - center[0];
  const dy = toward[1] - center[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const back: [number, number] = [center[0] - ux * 1e-6, center[1] - uy * 1e-6];
  const front: [number, number] = [center[0] + ux * radiusDeg, center[1] + uy * radiusDeg];
  const ring: [number, number][] = [
    [back[0] + px * radiusDeg, back[1] + py * radiusDeg],
    [back[0] - px * radiusDeg, back[1] - py * radiusDeg],
    [front[0] - px * radiusDeg, front[1] - py * radiusDeg],
    [front[0] + px * radiusDeg, front[1] + py * radiusDeg],
    [back[0] + px * radiusDeg, back[1] + py * radiusDeg],
  ];
  return { type: "Polygon", coordinates: [ring] };
}

function geomOrNull(g: Geometry | null | undefined): Polygon | MultiPolygon | null {
  if (!g) return null;
  if (g.type === "Polygon" || g.type === "MultiPolygon") return g;
  return null;
}

/**
 * Starting turf polygons: parcel minus building, split front/back by the
 * vector from the footprint centroid toward the geocoded street pin.
 */
export function prefillTurf(args: {
  parcel: Geometry | null;
  footprint: Geometry | null;
  location: Geometry | null;
}): PrefillFeature[] {
  const parcel = geomOrNull(args.parcel);
  if (!parcel) return [];
  const footprint = geomOrNull(args.footprint);

  let lawn: Polygon | MultiPolygon | null = parcel;
  if (footprint) {
    const cut = difference(featureCollection([asPolygonFeature(parcel), asPolygonFeature(footprint)]));
    if (cut?.geometry) lawn = toMulti(cut.geometry);
  }
  if (!lawn) return [];

  const street = args.location?.type === "Point" ? (args.location as Point) : null;
  if (!footprint || !street) {
    return [{ category: "turf_front", geometry: toMulti(lawn), source: "auto" }];
  }

  const c = centroid(asPolygonFeature(footprint)).geometry.coordinates as [number, number];
  const frontClip = halfPlane(c, street.coordinates as [number, number], Math.max(0.02, spanDeg(lawn) * 2));
  const lawnFeat = asPolygonFeature(lawn);
  const frontHit = intersect(featureCollection([lawnFeat, polygon(frontClip.coordinates)]));
  const backHit = frontHit ? difference(featureCollection([lawnFeat, frontHit])) : null;

  const out: PrefillFeature[] = [];
  if (frontHit?.geometry && (frontHit.geometry.type === "Polygon" || frontHit.geometry.type === "MultiPolygon")) {
    out.push({ category: "turf_front", geometry: toMulti(frontHit.geometry), source: "auto" });
  }
  if (backHit?.geometry && (backHit.geometry.type === "Polygon" || backHit.geometry.type === "MultiPolygon")) {
    out.push({ category: "turf_back", geometry: toMulti(backHit.geometry), source: "auto" });
  }
  if (out.length === 0) {
    out.push({ category: "turf_front", geometry: toMulti(lawn), source: "auto" });
  }
  return out;
}
