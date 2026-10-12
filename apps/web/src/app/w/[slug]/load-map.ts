"use server";

import { resolvePropertyGeo } from "@/lib/geo/resolve";
import { instantQuoteMapFromGeo, type InstantQuoteMap } from "@/lib/leads/instant-quote-measure";

const empty = instantQuoteMapFromGeo({ geocode: null, parcel: null, footprint: null });

/** Parcel and footprint for the public map. No price data leaves the server here. */
export async function loadInstantQuoteMap(address: string): Promise<InstantQuoteMap> {
  const trimmed = address.trim();
  if (!trimmed) return empty;
  try {
    return instantQuoteMapFromGeo(await resolvePropertyGeo(trimmed));
  } catch {
    return empty;
  }
}
