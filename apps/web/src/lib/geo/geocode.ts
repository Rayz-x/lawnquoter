import "server-only";

import type { AddressSuggestion, GeocodeResult } from "./types";

/**
 * Google Geocoding + Places Autocomplete. Google imagery is NOT used anywhere;
 * geocoding and autocomplete are permitted uses under the Maps Platform terms.
 */

function apiKey(): string | null {
  return process.env.GOOGLE_MAPS_SERVER_KEY ?? null;
}

type GoogleComponent = { long_name: string; short_name: string; types: string[] };

function component(components: GoogleComponent[], type: string, short = false) {
  const c = components.find((x) => x.types.includes(type));
  return c ? (short ? c.short_name : c.long_name) : "";
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const key = apiKey();
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    status: string;
    results: Array<{
      formatted_address: string;
      place_id: string;
      geometry: { location: { lat: number; lng: number } };
      address_components: GoogleComponent[];
    }>;
  };
  const first = json.results?.[0];
  if (json.status !== "OK" || !first) return null;
  const c = first.address_components;
  const streetNumber = component(c, "street_number");
  const route = component(c, "route");
  return {
    formattedAddress: first.formatted_address,
    placeId: first.place_id,
    location: { type: "Point", coordinates: [first.geometry.location.lng, first.geometry.location.lat] },
    addressLine1: [streetNumber, route].filter(Boolean).join(" "),
    city: component(c, "locality") || component(c, "sublocality") || component(c, "postal_town"),
    region: component(c, "administrative_area_level_1", true),
    postalCode: component(c, "postal_code"),
    country: component(c, "country", true) || "US",
  };
}

export async function autocompleteAddress(input: string, sessionToken?: string): Promise<AddressSuggestion[]> {
  const key = apiKey();
  if (!key || input.trim().length < 3) return [];
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({
      input,
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      includedRegionCodes: ["us", "ca"],
      ...(sessionToken ? { sessionToken } : {}),
    }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    suggestions?: Array<{ placePrediction?: { placeId: string; text: { text: string } } }>;
  };
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ description: p.text.text, placeId: p.placeId }));
}
