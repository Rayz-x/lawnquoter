import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Green Acres Lawn & Landscape")).toBe("green-acres-lawn-landscape");
  });
  it("strips diacritics and trims hyphens", () => {
    expect(slugify("  Café Lawns!! ")).toBe("cafe-lawns");
  });
  it("caps length at 63", () => {
    expect(slugify("a".repeat(100))).toHaveLength(63);
  });
});
