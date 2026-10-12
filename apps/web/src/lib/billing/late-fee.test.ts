import { describe, expect, it } from "vitest";
import { lateFeeCents } from "./late-fee";

describe("late fees", () => {
  it("charges a flat amount plus a percent after the grace days", () => {
    expect(lateFeeCents(10000, 1, 0, 2500, 0)).toBe(2500);
    expect(lateFeeCents(10000, 0, 0, 2500, 0)).toBe(0);
    expect(lateFeeCents(10000, 5, 5, 0, 200)).toBe(0);
    expect(lateFeeCents(10000, 6, 5, 0, 200)).toBe(200);
  });
});
