import type { QuantityMap } from "./types";

/** Sum turf front + back, falling back to a combined turf_sqft key. */
export function turfSqft(q: QuantityMap): number {
  const split = (q.turf_front_sqft ?? 0) + (q.turf_back_sqft ?? 0);
  if (split > 0) return split;
  return q.turf_sqft ?? 0;
}

export function readQty(q: QuantityMap, key: string): number {
  if (key === "turf_sqft") return turfSqft(q);
  return q[key] ?? 0;
}

const SQFT_PER_ACRE = 43560;

export function acresFromLot(lotSqft: number | null | undefined): number {
  if (!lotSqft) return 0;
  return lotSqft / SQFT_PER_ACRE;
}
