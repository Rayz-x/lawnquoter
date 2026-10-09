import "server-only";

import type { GeocodeResult } from "./types";

/**
 * Stored geocodes go through the ArcGIS World Geocoding Service with
 * forStorage=true. Google's geocoding terms forbid keeping lat/lng, and these
 * results are written to the properties table.
 *
 * The API key is read from ARCGIS_API_KEY and sent only as a request header.
 * Do not prefix that variable with NEXT_PUBLIC_.
 */
const FIND_ADDRESS_CANDIDATES =
  "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";

const GEOCODE_TIMEOUT_MS = 8_000;

const OUT_FIELDS = [
  "LongLabel",
  "ShortLabel",
  "StAddr",
  "City",
  "Region",
  "RegionAbbr",
  "Postal",
  "Country",
  "MatchID",
].join(",");

const ISO3_TO_ISO2: Record<string, string> = {
  USA: "US",
  CAN: "CA",
  MEX: "MX",
};

type CandidateAttributes = Record<string, unknown>;

type AddressCandidate = {
  address?: string;
  location?: { x?: unknown; y?: unknown };
  attributes?: CandidateAttributes;
};

type FindAddressCandidatesResponse = {
  candidates?: AddressCandidate[];
  error?: { message?: string };
};

function apiKey(): string | null {
  const key = process.env.ARCGIS_API_KEY?.trim();
  return key ? key : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function attribute(attributes: CandidateAttributes | undefined, name: string): string {
  return text(attributes?.[name]);
}

function countryCode(value: string): string {
  if (!value) return "";
  const upper = value.toUpperCase();
  return ISO3_TO_ISO2[upper] ?? (upper.length === 2 ? upper : value);
}

function finiteCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const key = apiKey();
  const singleLine = address.trim();
  if (!key || !singleLine) return null;

  const url = new URL(FIND_ADDRESS_CANDIDATES);
  url.searchParams.set("f", "json");
  url.searchParams.set("SingleLine", singleLine);
  url.searchParams.set("forStorage", "true");
  url.searchParams.set("maxLocations", "1");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("outFields", OUT_FIELDS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Esri-Authorization": `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let json: FindAddressCandidatesResponse;
  try {
    json = (await res.json()) as FindAddressCandidatesResponse;
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || json.error) return null;

  const first = json.candidates?.[0];
  if (!first) return null;

  const lng = finiteCoordinate(first.location?.x);
  const lat = finiteCoordinate(first.location?.y);
  const formattedAddress = attribute(first.attributes, "LongLabel") || text(first.address);
  if (lng === null || lat === null || !formattedAddress) return null;

  const matchId = attribute(first.attributes, "MatchID");
  return {
    formattedAddress,
    placeId: matchId || null,
    location: { type: "Point", coordinates: [lng, lat] },
    addressLine1: attribute(first.attributes, "StAddr") || attribute(first.attributes, "ShortLabel"),
    city: attribute(first.attributes, "City"),
    region: attribute(first.attributes, "RegionAbbr") || attribute(first.attributes, "Region"),
    postalCode: attribute(first.attributes, "Postal"),
    country: countryCode(attribute(first.attributes, "Country")),
  };
}
