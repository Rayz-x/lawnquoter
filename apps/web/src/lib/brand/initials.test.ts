import { describe, expect, it } from "vitest";
import { companyInitials, logoShowsName } from "./initials";

describe("companyInitials", () => {
  it("skips company suffixes and joins the first two words", () => {
    expect(companyInitials("Green Acres Lawn Co.")).toBe("GA");
    expect(companyInitials("Red Oak & Sons LLC")).toBe("RO");
    expect(companyInitials("Sunny Side")).toBe("SS");
    expect(companyInitials("Acme")).toBe("A");
  });
});

describe("logoShowsName", () => {
  it("shows the name for a missing logo, a square mark, and an explicit override", () => {
    expect(logoShowsName({ logo_url: null, logo_shows_name: null, logo_width: null, logo_height: null })).toBe(true);
    expect(logoShowsName({ logo_url: "a/b.png", logo_shows_name: null, logo_width: 200, logo_height: 200 })).toBe(true);
    expect(logoShowsName({ logo_url: "a/b.png", logo_shows_name: null, logo_width: 600, logo_height: 120 })).toBe(false);
    expect(logoShowsName({ logo_url: "a/b.png", logo_shows_name: true, logo_width: 600, logo_height: 120 })).toBe(true);
  });
});
