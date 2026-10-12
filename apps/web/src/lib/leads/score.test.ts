import { describe, expect, it } from "vitest";
import { scoreLead } from "./score";

const minimumLotSqft = 4000;

describe("scoreLead", () => {
  it("scores a large in-area matching lead as quote now at 100", () => {
    // 25 size + 25 service + 20 distance + 15 source + 15 engagement
    const result = scoreLead({
      lotSqft: 8000,
      minimumLotSqft,
      requestedServices: ["Mowing"],
      offeredServices: ["mowing", "cleanup"],
      outOfArea: false,
      sourceWinRate: 0.5,
      engaged: true,
    });
    expect(result).toEqual({ score: 100, recommendation: "quote_now" });
  });

  it("scores a small out-of-area mismatch as qualify first at 10", () => {
    // 5 size + 0 service + 0 distance + 5 source + 0 engagement
    const result = scoreLead({
      lotSqft: 1000,
      minimumLotSqft,
      requestedServices: ["snow"],
      offeredServices: ["mowing"],
      outOfArea: true,
      sourceWinRate: 0.1,
      engaged: false,
    });
    expect(result).toEqual({ score: 10, recommendation: "qualify_first" });
  });

  it("qualifies first when the lead is out of area even with a high score", () => {
    const result = scoreLead({
      lotSqft: 8000,
      minimumLotSqft,
      requestedServices: ["mowing"],
      offeredServices: ["mowing"],
      outOfArea: true,
      sourceWinRate: 0.5,
      engaged: true,
    });
    expect(result.score).toBe(80);
    expect(result.recommendation).toBe("qualify_first");
  });
});
