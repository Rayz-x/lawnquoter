import type { Position } from "@lawnquoter/shared";

/** Ray-casting point in polygon on lng/lat (fine at parcel scale). */
export function pointInRing(pt: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
