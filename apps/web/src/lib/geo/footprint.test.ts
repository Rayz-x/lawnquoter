import { describe, expect, it } from "vitest";
import { pointInRing } from "./geometry";

const square = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
] as [number, number][];

describe("pointInRing", () => {
  it("detects inside", () => {
    expect(pointInRing([0.5, 0.5], square)).toBe(true);
  });
  it("detects outside", () => {
    expect(pointInRing([1.5, 0.5], square)).toBe(false);
  });
});
