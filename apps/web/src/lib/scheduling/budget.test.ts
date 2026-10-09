import { describe, expect, it } from "vitest";
import { budgetMinutes } from "./budget";

describe("budgetMinutes", () => {
  it("turns line hours into minutes for a one-person crew", () => {
    expect(budgetMinutes([1.5, 0], 1)).toBe(90);
  });

  it("divides by crew size and rounds half up", () => {
    expect(budgetMinutes([1.5, 0.01], 1)).toBe(91);
    expect(budgetMinutes([3], 2)).toBe(90);
    expect(budgetMinutes([1], 7)).toBe(9);
  });

  it("treats an empty selection as zero minutes", () => {
    expect(budgetMinutes([], 2)).toBe(0);
  });

  it("rejects a crew size below 1", () => {
    expect(() => budgetMinutes([1], 0)).toThrow(/crew_size/);
    expect(() => budgetMinutes([1], 1.5)).toThrow(/crew_size/);
  });

  it("rejects negative hours", () => {
    expect(() => budgetMinutes([-1], 1)).toThrow(/hours/);
  });
});
