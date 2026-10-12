import { describe, expect, it } from "vitest";
import { enhancementTitle } from "./enhancement";

describe("enhancement proposal", () => {
  it("keeps a trimmed title", () => {
    expect(enhancementTitle("  Mulch the beds  ")).toBe("Mulch the beds");
  });

  it("refuses a blank title", () => {
    expect(enhancementTitle("   ")).toBeNull();
  });
});
