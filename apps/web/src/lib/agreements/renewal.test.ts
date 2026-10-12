import { describe, expect, it } from "vitest";
import { dueForRenewal, renewalPrice } from "./renewal";

describe("renewal pipeline", () => {
  it("raises $400 by 5 percent to $420", () => {
    expect(renewalPrice(40000, 5)).toBe(42000);
  });

  it("rounds 199 cents up by 10 percent to 219 cents", () => {
    expect(renewalPrice(199, 10)).toBe(219);
  });

  it("includes an end date inside the window and leaves a later one out", () => {
    expect(dueForRenewal("2026-10-22", "2026-10-12", 30)).toBe(true);
    expect(dueForRenewal("2026-12-01", "2026-10-12", 30)).toBe(false);
    expect(dueForRenewal("2026-10-01", "2026-10-12", 30)).toBe(false);
  });
});
