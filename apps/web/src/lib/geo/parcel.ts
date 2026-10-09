import "server-only";

import { multiPolygonSchema, polygonSchema } from "@lawnquoter/shared";
import type { ParcelResult } from "./types";

/**
 * Regrid parcel lookup by point. Requires REGRID_API_TOKEN.
 * https://support.regrid.com/docs/getting-started-api
 */
export async function lookupParcel(lng: number, lat: number): Promise<ParcelResult | null> {
  const token = process.env.REGRID_API_TOKEN;
  if (!token) return null;
  const url = new URL("https://app.regrid.com/api/v2/parcels/point");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("token", token);
  url.searchParams.set("return_geometry", "true");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    parcels?: {
      features?: Array<{
        geometry: unknown;
        properties?: { fields?: { parcelnumb?: string; ll_gissqft?: number; gisacre?: number } };
      }>;
    };
  };
  const feature = json.parcels?.features?.[0];
  if (!feature) return null;
  const geom = polygonSchema.safeParse(feature.geometry).success
    ? polygonSchema.parse(feature.geometry)
    : multiPolygonSchema.safeParse(feature.geometry).success
      ? multiPolygonSchema.parse(feature.geometry)
      : null;
  if (!geom) return null;
  const fields = feature.properties?.fields ?? {};
  return {
    geometry: geom,
    apn: fields.parcelnumb ?? null,
    source: "regrid",
    reportedSqft: fields.ll_gissqft ?? (fields.gisacre ? fields.gisacre * 43560 : null),
  };
}
