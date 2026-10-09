import { describe, expect, it } from "vitest";
import { isIsoDate, orgToday } from "./office-date";

describe("orgToday", () => {
  it("uses the org timezone, and UTC when the zone is unknown", () => {
    const instant = new Date("2026-10-09T03:30:00Z");
    expect(orgToday("UTC", instant)).toBe("2026-10-09");
    expect(orgToday("America/Los_Angeles", instant)).toBe("2026-10-08");
    expect(orgToday("not-a-zone", instant)).toBe("2026-10-09");
  });
});

describe("isIsoDate", () => {
  it("accepts real calendar days only", () => {
    expect(isIsoDate("2026-10-09")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("10/09/2026")).toBe(false);
  });
});
