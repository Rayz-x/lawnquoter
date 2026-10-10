import type { QuantityMap } from "./types";

/** Sum turf front + back and a combined turf_sqft key, keeping the larger figure. */
export function turfSqft(q: QuantityMap): number {
  const split = (q.turf_front_sqft ?? 0) + (q.turf_back_sqft ?? 0);
  return Math.max(split, q.turf_sqft ?? 0);
}

export function readQty(q: QuantityMap, key: string): number {
  if (key === "turf_sqft") return turfSqft(q);
  return q[key] ?? 0;
}
