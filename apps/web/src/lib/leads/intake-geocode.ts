import "server-only";

import { geocodeAddress } from "@/lib/geo/geocode";
import type { LeadIntakeGeocode } from "./submit-request";

/** Thin adapter so intake can stub geocode in tests. Uses forStorage via geocodeAddress. */
export async function geocodeForLeadIntake(address: string): Promise<LeadIntakeGeocode | null> {
  const result = await geocodeAddress(address);
  if (!result) return null;
  const [lng, lat] = result.location.coordinates;
  return {
    score: result.score,
    addressType: result.addressType,
    line1: result.addressLine1 || result.formattedAddress || null,
    city: result.city || null,
    region: result.region || null,
    postalCode: result.postalCode || null,
    country: result.country || "US",
    lng,
    lat,
    attribution: "Esri",
    raw: {
      formattedAddress: result.formattedAddress,
      placeId: result.placeId,
      score: result.score,
      addressType: result.addressType,
      lng,
      lat,
    },
  };
}
