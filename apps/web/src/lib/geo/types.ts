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

export type AddressSuggestion = {
  description: string;
  placeId: string;
};
