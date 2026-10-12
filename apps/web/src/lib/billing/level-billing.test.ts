import { describe, expect, it } from "vitest";
import { levelInstallmentCents } from "./level-billing";

describe("level billing", () => {
  it("splits 1000 dollars across 12 months and keeps the remainder on the last month", () => {
    expect(levelInstallmentCents(100000, 12, 1)).toBe(8333);
    expect(levelInstallmentCents(100000, 12, 11)).toBe(8333);
    expect(levelInstallmentCents(100000, 12, 12)).toBe(8337);
    const year = Array.from({ length: 12 }, (_, index) => levelInstallmentCents(100000, 12, index + 1));
    expect(year.reduce((sum, cents) => sum + cents, 0)).toBe(100000);
  });

  it("returns zero when the month is outside the billing window", () => {
    expect(levelInstallmentCents(100000, 12, 0)).toBe(0);
    expect(levelInstallmentCents(100000, 12, 13)).toBe(0);
    expect(levelInstallmentCents(0, 12, 1)).toBe(0);
  });
});
