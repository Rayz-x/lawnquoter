import { describe, expect, it } from "vitest";
import type { Polygon } from "@lawnquoter/shared";
import { chooseLawnSize } from "./instant-quote-measure";

const lot: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-86.8, 36.1],
      [-86.8, 36.101],
      [-86.799, 36.101],
      [-86.799, 36.1],
      [-86.8, 36.1],
    ],
  ],
};

const empty = {
  trace: null,
  parcel: null,
  parcelSource: null,
  footprint: null,
  footprintSource: null,
  location: null,
  lengthFt: null,
  widthFt: null,
};

describe("chooseLawnSize", () => {
  it("uses the parcel minus the house when the customer has not traced", () => {
    expect(
      chooseLawnSize({
        ...empty,
        parcel: lot,
        parcelSource: "regrid",
        lengthFt: 10,
        widthFt: 10,
      }),
    ).toEqual({ sqft: 107_534, confidence: 0.45, source: "prefill" });
  });

  it("subtracts the house from the lot", () => {
    const house: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-86.7996, 36.1002],
          [-86.7996, 36.1006],
          [-86.7994, 36.1006],
          [-86.7994, 36.1002],
          [-86.7996, 36.1002],
        ],
      ],
    };
    expect(
      chooseLawnSize({
        ...empty,
        parcel: lot,
        parcelSource: "regrid",
        footprint: house,
        footprintSource: "osm",
      }),
    ).toEqual({ sqft: 98_931, confidence: 0.7, source: "prefill" });
  });

  it("lets a traced lawn replace the parcel", () => {
    expect(
      chooseLawnSize({
        ...empty,
        trace: lot,
        parcel: lot,
        parcelSource: "regrid",
      }),
    ).toEqual({ sqft: 107_534, confidence: 0.37, source: "trace" });
  });

  it("falls back to length times width only when there is no lot and no trace", () => {
    expect(chooseLawnSize({ ...empty, lengthFt: 10, widthFt: 10 })).toEqual({
      sqft: 100,
      confidence: 0.1,
      source: "rectangle",
    });
    expect(chooseLawnSize(empty)).toBeNull();
  });
});
