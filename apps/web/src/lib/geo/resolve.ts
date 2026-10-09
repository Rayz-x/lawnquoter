import "server-only";

import { lookupFootprint } from "./footprint";
import { geocodeAddress } from "./geocode";
import { lookupParcel } from "./parcel";
import type { FootprintResult, GeocodeResult, ParcelResult } from "./types";

export type ResolvedPropertyGeo = {
  geocode: GeocodeResult | null;
  parcel: ParcelResult | null;
  footprint: FootprintResult | null;
  warnings: string[];
};

/** Address -> point -> parcel + footprint. Each provider is optional and failures degrade gracefully. */
export async function resolvePropertyGeo(address: string): Promise<ResolvedPropertyGeo> {
  const warnings: string[] = [];
  const geocode = await geocodeAddress(address);
  if (!geocode) {
    warnings.push(
      process.env.ARCGIS_API_KEY?.trim()
        ? "Address could not be geocoded."
        : "Geocoding is not configured (ARCGIS_API_KEY).",
    );
    return { geocode: null, parcel: null, footprint: null, warnings };
  }
  const [lng, lat] = geocode.location.coordinates;
  const [parcel, footprint] = await Promise.all([lookupParcel(lng, lat), lookupFootprint(lng, lat)]);
  if (!parcel) {
    warnings.push(
      process.env.REGRID_API_TOKEN
        ? "No parcel boundary found for this address; trace the lot manually."
        : "Parcel lookup is not configured (REGRID_API_TOKEN); trace the lot manually.",
    );
  }
  if (!footprint) warnings.push("No building footprint found; trace the house manually.");
  return { geocode, parcel, footprint, warnings };
}
