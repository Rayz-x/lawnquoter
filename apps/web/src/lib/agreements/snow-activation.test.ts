import { describe, expect, it } from "vitest";
import { snowActivates } from "./snow-activation";

describe("snow event activation", () => {
  it("stays quiet under a 2 inch trigger and activates at 2 inches", () => {
    expect(snowActivates(2, 1)).toBe(false);
    expect(snowActivates(2, 2)).toBe(true);
  });
});
