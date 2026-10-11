import { describe, expect, it } from "vitest";
import {
  GATE_WIDTH_CHIPS,
  GATE_WIDTH_NO_GATE,
  gateWidthChip,
  gateWidthFromChip,
  gateWidthLabel,
} from "./gate";

describe("gate width chips", () => {
  it("lists Under 48 in, 48 in+, and No gate — not Unknown", () => {
    expect(GATE_WIDTH_CHIPS.map((chip) => chip.label)).toEqual(["Under 48 in", "48 in+", "No gate"]);
    expect(GATE_WIDTH_CHIPS.map((chip) => chip.value)).not.toContain("unknown");
  });

  it("maps chips to stored widths and back; empty chip is unknown", () => {
    expect(gateWidthFromChip("")).toBeNull();
    expect(gateWidthFromChip("none")).toBe(GATE_WIDTH_NO_GATE);
    expect(gateWidthFromChip("under")).toBe(36);
    expect(gateWidthFromChip("wide")).toBe(48);
    expect(gateWidthChip(null)).toBe("");
    expect(gateWidthChip(undefined)).toBe("");
    expect(gateWidthChip(0)).toBe("none");
    expect(gateWidthChip(36)).toBe("under");
    expect(gateWidthChip(40)).toBe("under");
    expect(gateWidthChip(48)).toBe("wide");
    expect(gateWidthChip(60)).toBe("wide");
  });

  it("labels stored widths for crew and office", () => {
    expect(gateWidthLabel(null)).toBeNull();
    expect(gateWidthLabel(GATE_WIDTH_NO_GATE)).toBe("No gate");
    expect(gateWidthLabel(36)).toBe("36″ gate");
  });
});
