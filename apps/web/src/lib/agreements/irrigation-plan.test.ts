import { describe, expect, it } from "vitest";
import { irrigationVisit } from "./irrigation-plan";

describe("irrigation plan", () => {
  it("prices six zones at $12 and sets a 48 minute visit", () => {
    expect(irrigationVisit(6, 12, 8)).toEqual({ price: 72, minutes: 48 });
  });
});
