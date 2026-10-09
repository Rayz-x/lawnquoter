import { describe, expect, it } from "vitest";
import { defaultThroughDate, expandVisitDates } from "./recurrence";

describe("expandVisitDates", () => {
  it("steps weekly on the preferred weekday, including the through date", () => {
    expect(
      expandVisitDates({
        startDate: "2026-03-02",
        throughDate: "2026-03-23",
        frequency: "weekly",
        preferredDow: 1,
      }),
    ).toEqual(["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"]);
  });

  it("moves a weekly series forward onto the preferred weekday", () => {
    expect(
      expandVisitDates({
        startDate: "2026-03-04",
        throughDate: "2026-03-18",
        frequency: "weekly",
        preferredDow: 1,
      }),
    ).toEqual(["2026-03-09", "2026-03-16"]);
  });

  it("steps biweekly from the aligned start", () => {
    expect(
      expandVisitDates({
        startDate: "2026-03-02",
        throughDate: "2026-03-30",
        frequency: "biweekly",
        preferredDow: 1,
      }),
    ).toEqual(["2026-03-02", "2026-03-16", "2026-03-30"]);
  });

  it("keeps the calendar day each month and clamps February", () => {
    expect(
      expandVisitDates({
        startDate: "2026-01-31",
        throughDate: "2026-04-30",
        frequency: "monthly",
        preferredDow: 1,
      }),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("treats custom as weekly on the required weekday", () => {
    expect(
      expandVisitDates({
        startDate: "2026-03-04",
        throughDate: "2026-03-25",
        frequency: "custom",
        preferredDow: 1,
      }),
    ).toEqual(["2026-03-09", "2026-03-16", "2026-03-23"]);
  });

  it("rejects custom without a preferred day", () => {
    expect(() =>
      expandVisitDates({
        startDate: "2026-03-04",
        throughDate: "2026-03-25",
        frequency: "custom",
      }),
    ).toThrow(/preferred day/);
  });

  it("stops at the agreement end date", () => {
    expect(
      expandVisitDates({
        startDate: "2026-03-02",
        throughDate: "2026-04-30",
        endDate: "2026-03-16",
        frequency: "weekly",
        preferredDow: 1,
      }),
    ).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
  });

  it("returns nothing when the horizon ends before the start", () => {
    expect(
      expandVisitDates({
        startDate: "2026-03-10",
        throughDate: "2026-03-01",
        frequency: "weekly",
      }),
    ).toEqual([]);
  });

  it("uses an 8 week horizon for the office default", () => {
    expect(defaultThroughDate("2026-10-09")).toBe("2026-12-04");
  });
});
