import { describe, expect, it } from "vitest";
import { DEFAULT_SEASON, formatSeasonLabel, isDateInSeason } from "./season";

describe("isDateInSeason", () => {
  it("includes Apr 1 and Nov 15 in the default season", () => {
    expect(isDateInSeason("2026-04-01")).toBe(true);
    expect(isDateInSeason("2026-11-15")).toBe(true);
  });

  it("excludes dates outside the default season", () => {
    expect(isDateInSeason("2026-03-31")).toBe(false);
    expect(isDateInSeason("2026-11-16")).toBe(false);
    expect(isDateInSeason("2026-01-15")).toBe(false);
  });

  it("supports a custom window", () => {
    const short = { startMonth: 5, startDay: 1, endMonth: 5, endDay: 31 };
    expect(isDateInSeason("2026-05-15", short)).toBe(true);
    expect(isDateInSeason("2026-06-01", short)).toBe(false);
  });

  it("supports a season that wraps year-end", () => {
    const winter = { startMonth: 11, startDay: 1, endMonth: 3, endDay: 15 };
    expect(isDateInSeason("2026-12-01", winter)).toBe(true);
    expect(isDateInSeason("2026-02-01", winter)).toBe(true);
    expect(isDateInSeason("2026-06-01", winter)).toBe(false);
  });
});

describe("formatSeasonLabel", () => {
  it("labels the default season", () => {
    expect(formatSeasonLabel(DEFAULT_SEASON)).toBe("Apr 1–Nov 15");
  });
});
