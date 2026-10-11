import { describe, expect, it } from "vitest";
import { MENU_POSITIONER_CLASS, menuSide } from "./office-nav";

describe("office nav menus", () => {
  it("stack above the sticky top bar and phone tab bar (z-40)", () => {
    expect(MENU_POSITIONER_CLASS.split(" ")).toContain("z-50");
  });
  it("open downward on desktop and upward only from the phone tab bar", () => {
    expect(menuSide(false)).toBe("bottom");
    expect(menuSide(true)).toBe("top");
  });
});
