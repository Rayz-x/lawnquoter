import { describe, expect, it } from "vitest";
import { priceLine } from "./price";
import { mergeModifiers, type CatalogRule } from "./types";
import { GATE_WIDTH_NO_GATE, isNarrowGate } from "./gate-width";

const small: CatalogRule = {
  type: "catalog",
  materialCost: 10,
  laborCost: 0,
  laborHours: 1,
  materialMarkupPct: 0,
  laborMarkupPct: 0,
};

describe("isNarrowGate", () => {
  it("treats unknown and no gate as not narrow", () => {
    expect(isNarrowGate(null)).toBe(false);
    expect(isNarrowGate(undefined)).toBe(false);
    expect(isNarrowGate(GATE_WIDTH_NO_GATE)).toBe(false);
    expect(isNarrowGate(36)).toBe(true);
    expect(isNarrowGate(48)).toBe(false);
  });
});

describe("narrow gate pricing", () => {
  const modifiers = mergeModifiers({});

  it("does not charge a narrow-gate fee when the width is unknown", () => {
    for (const gateWidthIn of [null, undefined] as const) {
      const priced = priceLine({ rule: small, quantities: {}, modifiers, context: { gateWidthIn } });
      expect(priced.breakdown.some((row) => row.label.startsWith("Narrow gate"))).toBe(false);
      expect(priced.price).toBe(45);
    }
  });

  it("does not charge a narrow-gate fee when there is no gate", () => {
    const priced = priceLine({
      rule: small,
      quantities: {},
      modifiers,
      context: { gateWidthIn: GATE_WIDTH_NO_GATE },
    });
    expect(priced.breakdown.some((row) => row.label.startsWith("Narrow gate"))).toBe(false);
    expect(priced.price).toBe(45);
  });

  it("charges a narrow-gate fee for a measured under-48 gate", () => {
    const priced = priceLine({
      rule: small,
      quantities: {},
      modifiers,
      context: { gateWidthIn: 36 },
    });
    expect(priced.breakdown.some((row) => row.label === "Narrow gate (36 in)")).toBe(true);
  });
});
