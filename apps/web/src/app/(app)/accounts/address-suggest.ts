"use server";

import { requireOrg } from "@/lib/auth/session";
import { suggestAddresses } from "@/lib/geo/geocode";
import type { GeocodeResult } from "@/lib/geo/types";

export async function suggestPropertyAddresses(query: string): Promise<GeocodeResult[]> {
  await requireOrg();
  return suggestAddresses(query);
}
