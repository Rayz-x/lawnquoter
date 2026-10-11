import type { MultiPolygon, Point, Polygon } from "@lawnquoter/shared";

export type GeocodeResult = {
  formattedAddress: string;
  placeId: string | null;
  location: Point;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  /** Esri candidate score normalized to 0–1 when present. */
  score: number | null;
  /** Esri Addr_type (e.g. PointAddress, StreetAddress). */
  addressType: string | null;
};

export type ParcelResult = {
  geometry: Polygon | MultiPolygon;
  apn: string | null;
  source: "regrid" | "county";
  /** Lot area reported by the data provider, if any (sq ft). */
  reportedSqft: number | null;
};

export type FootprintResult = {
  geometry: Polygon | MultiPolygon;
  source: "overture" | "osm";
};
