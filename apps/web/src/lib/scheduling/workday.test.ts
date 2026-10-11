import { describe, expect, it } from "vitest";
import { nextWorkday } from "./workday";

describe("nextWorkday", () => {
  it("pushes Friday to Monday when Saturday is off", () => {
    expect(nextWorkday("2026-10-09")).toBe("2026-10-12");
  });

  it("pushes Friday to Saturday when Saturday is a workday", () => {
    expect(nextWorkday("2026-10-09", { saturdayWorkday: true })).toBe("2026-10-10");
  });

  it("pushes Thursday to Friday", () => {
    expect(nextWorkday("2026-10-08")).toBe("2026-10-09");
  });

  it("skips Sunday to Monday", () => {
    expect(nextWorkday("2026-10-10")).toBe("2026-10-12");
  });
});
