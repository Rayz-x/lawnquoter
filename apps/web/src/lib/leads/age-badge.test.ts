import { describe, expect, it } from "vitest";
import { leadAgeMinutes, leadAgeTone } from "./age-badge";

describe("leadAgeTone", () => {
  it("stays ok at 29 minutes against a 60-minute target", () => {
    expect(leadAgeTone(29, 60)).toBe("ok");
  });

  it("turns amber at 31 minutes against a 60-minute target", () => {
    expect(leadAgeTone(31, 60)).toBe("amber");
  });

  it("turns red at 61 minutes against a 60-minute target", () => {
    expect(leadAgeTone(61, 60)).toBe("red");
  });

  it("hits amber and red exactly on the half and full target", () => {
    expect(leadAgeTone(30, 60)).toBe("amber");
    expect(leadAgeTone(60, 60)).toBe("red");
  });
});

describe("leadAgeMinutes", () => {
  it("computes whole-minute age from created_at", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    const created = new Date("2026-10-10T11:29:00.000Z");
    expect(leadAgeMinutes(created.toISOString(), now)).toBe(31);
  });
});
