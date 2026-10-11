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
  "Addr_type",
].join(",");

function normalizeEsriScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Esri scores are 0–100; store as 0–1 for lead_requests.geocode_score.
  if (value > 1) return Math.min(1, Math.max(0, value / 100));
  return Math.min(1, Math.max(0, value));
}

const ISO3_TO_ISO2: Record<string, string> = {
  USA: "US",
  CAN: "CA",
  MEX: "MX",
};

type CandidateAttributes = Record<string, unknown>;

type AddressCandidate = {
  address?: string;
  score?: unknown;
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

function toResult(candidate: AddressCandidate | undefined): GeocodeResult | null {
  if (!candidate) return null;
  const lng = finiteCoordinate(candidate.location?.x);
  const lat = finiteCoordinate(candidate.location?.y);
  const formattedAddress = attribute(candidate.attributes, "LongLabel") || text(candidate.address);
  if (lng === null || lat === null || !formattedAddress) return null;
  const matchId = attribute(candidate.attributes, "MatchID");
  return {
    formattedAddress,
    placeId: matchId || null,
    location: { type: "Point", coordinates: [lng, lat] },
    addressLine1: attribute(candidate.attributes, "StAddr") || attribute(candidate.attributes, "ShortLabel"),
    city: attribute(candidate.attributes, "City"),
    region: attribute(candidate.attributes, "RegionAbbr") || attribute(candidate.attributes, "Region"),
    postalCode: attribute(candidate.attributes, "Postal"),
    country: countryCode(attribute(candidate.attributes, "Country")),
    score: normalizeEsriScore(candidate.score),
    addressType: attribute(candidate.attributes, "Addr_type") || null,
  };
}

async function requestCandidates(params: Record<string, string>): Promise<AddressCandidate[]> {
  const key = apiKey();
  if (!key) return [];
  const url = new URL(FIND_ADDRESS_CANDIDATES);
  url.searchParams.set("f", "json");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("outFields", OUT_FIELDS);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

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
    return [];
  }
  if (!res.ok) return [];

  let json: FindAddressCandidatesResponse;
  try {
    json = (await res.json()) as FindAddressCandidatesResponse;
  } catch {
    return [];
  }
  if (!json || typeof json !== "object" || json.error) return [];
  return json.candidates ?? [];
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const singleLine = address.trim();
  if (!singleLine) return null;
  const candidates = await requestCandidates({
    SingleLine: singleLine,
    forStorage: "true",
    maxLocations: "1",
  });
  return toResult(candidates[0]);
}

/** Suggestions are not stored. An empty list means there is no key or no match. */
export async function suggestAddresses(address: string): Promise<GeocodeResult[]> {
  const singleLine = address.trim();
  if (singleLine.length < 3) return [];
  const candidates = await requestCandidates({
    SingleLine: singleLine,
    forStorage: "false",
    maxLocations: "5",
    countryCode: "USA",
  });
  return candidates.flatMap((candidate) => {
    const result = toResult(candidate);
    return result ? [result] : [];
  });
}
