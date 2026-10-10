import { describe, expect, it } from "vitest";
import { VISIT_HORIZON_DAYS, nextVisitsThroughLabel } from "./horizon";

describe("rolling visit horizon", () => {
  it("targets about 10 weeks", () => {
    expect(VISIT_HORIZON_DAYS).toBe(70);
  });

  it("labels the furthest planned visit", () => {
    expect(nextVisitsThroughLabel("2026-05-11")).toBe("Next visits through Monday, May 11, 2026");
  });

  it("returns null when nothing is scheduled", () => {
    expect(nextVisitsThroughLabel(null)).toBeNull();
    expect(nextVisitsThroughLabel(undefined)).toBeNull();
  });
});
