import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyRange } from "./money";

describe("formatMoney", () => {
  it("adds thousands separators and drops cents on whole-dollar line amounts", () => {
    expect(formatMoney(1200)).toBe("$1,200");
    expect(formatMoney(1601)).toBe("$1,601");
    expect(formatMoney(280)).toBe("$280");
  });

  it("keeps cents when the amount is not a whole dollar", () => {
    expect(formatMoney(1601.5)).toBe("$1,601.50");
  });

  it("always shows cents for a total", () => {
    expect(formatMoney(1601, { cents: true })).toBe("$1,601.00");
    expect(formatMoney(0, { cents: true })).toBe("$0.00");
  });

  it("formats a range with a spaced en dash", () => {
    expect(formatMoneyRange(280, 310)).toBe("$280 – $310");
  });
});
