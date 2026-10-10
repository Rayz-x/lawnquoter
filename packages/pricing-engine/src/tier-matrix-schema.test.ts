import { describe, expect, it } from "vitest";
import { priceLine } from "./price";
import { defaultModifiers, tierMatrixRuleSchema } from "./types";

const rows = [
  { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
  { upTo: null, price: 70, hours: 1, cost: 32 },
];
const rule = { type: "tier_matrix" as const, quantityKey: "turf_sqft", rows };

describe("tier rules", () => {
  it("rejects an open-ended tier before the last row", () => {
    expect(tierMatrixRuleSchema.safeParse({ ...rule, rows: [rows[1], rows[0]] }).success).toBe(false);
  });
  it("rejects skipping the company minimum and still charges $45", () => {
    expect(tierMatrixRuleSchema.safeParse({ ...rule, skipModifiers: ["minimum"] }).success).toBe(false);
    const priced = priceLine({
      rule: { ...rule, rows: [{ upTo: null, price: 20, hours: 0.25, cost: 10 }], skipModifiers: ["minimum"] },
      quantities: { turf_sqft: 1000 },
      modifiers: defaultModifiers(),
    });
    expect(priced.price).toBeGreaterThanOrEqual(45);
  });
  it("allows skipping slope", () => {
    expect(tierMatrixRuleSchema.safeParse({ ...rule, skipModifiers: ["slope"] }).success).toBe(true);
  });
});
