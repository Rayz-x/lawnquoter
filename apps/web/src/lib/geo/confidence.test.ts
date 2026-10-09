import { describe, expect, it } from "vitest";
import { scoreMeasurementConfidence } from "./confidence";

describe("scoreMeasurementConfidence", () => {
  it("scores a high-confidence lookup", () => {
    const r = scoreMeasurementConfidence({
      parcelSource: "regrid",
      footprintSource: "osm",
      imageryDate: new Date(),
    });
    expect(r.band).toBe("high");
    expect(r.score).toBeGreaterThanOrEqual(0.8);
  });

  it("drops to low without parcel or footprint and old imagery", () => {
    const r = scoreMeasurementConfidence({
      parcelSource: "unknown",
      footprintSource: null,
      imageryDate: "2010-01-01",
    });
    expect(r.band).toBe("low");
    expect(r.reasons.some((x) => x.includes("No parcel"))).toBe(true);
  });

  it("penalizes heavy canopy", () => {
    const base = scoreMeasurementConfidence({
      parcelSource: "regrid",
      footprintSource: "osm",
      imageryDate: new Date(),
    });
    const canopy = scoreMeasurementConfidence({
      parcelSource: "regrid",
      footprintSource: "osm",
      imageryDate: new Date(),
      canopyOverlapPct: 50,
    });
    expect(canopy.score).toBeLessThan(base.score);
  });
});
