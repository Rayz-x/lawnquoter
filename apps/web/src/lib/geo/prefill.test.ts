import { describe, expect, it } from "vitest";
import { prefillTurf } from "./prefill";
import type { Point, Polygon } from "@lawnquoter/shared";

const parcel: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 0],
      [0, 0],
    ],
  ],
};

const footprint: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [1.5, 1.5],
      [1.5, 2.5],
      [2.5, 2.5],
      [2.5, 1.5],
      [1.5, 1.5],
    ],
  ],
};

const street: Point = { type: "Point", coordinates: [2, -1] };

describe("prefillTurf", () => {
  it("returns empty without a parcel", () => {
    expect(prefillTurf({ parcel: null, footprint: null, location: null })).toEqual([]);
  });

  it("uses the whole lot as front turf when there is no footprint", () => {
    const out = prefillTurf({ parcel, footprint: null, location: street });
    expect(out).toHaveLength(1);
    expect(out[0]?.category).toBe("turf_front");
    expect(out[0]?.source).toBe("auto");
  });

  it("splits front and back when footprint and street pin exist", () => {
    const out = prefillTurf({ parcel, footprint, location: street });
    const cats = out.map((f) => f.category).sort();
    expect(cats).toEqual(["turf_back", "turf_front"]);
  });
});
