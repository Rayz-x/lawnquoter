import { describe, expect, it } from "vitest";
import { progressChargeCents } from "./progress-billing";

describe("progress billing", () => {
  it("bills the percent of the line and then only what is left", () => {
    expect(progressChargeCents(100000, 0, 40)).toBe(40000);
    expect(progressChargeCents(100000, 40000, 40)).toBe(0);
    expect(progressChargeCents(100000, 40000, 100)).toBe(60000);
    expect(progressChargeCents(100000, 0, 100)).toBe(100000);
  });
});
