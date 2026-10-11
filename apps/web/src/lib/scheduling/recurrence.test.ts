import { describe, expect, it } from "vitest";
import { addDays } from "./recurrence";

describe("addDays", () => {
  it("adds days on the calendar", () => {
    expect(addDays("2026-03-02", 7)).toBe("2026-03-09");
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
  });
});
