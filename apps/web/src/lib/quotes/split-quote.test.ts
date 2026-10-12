import { describe, expect, it } from "vitest";
import { planQuoteSplit } from "./split-quote";

const lines = [
  { id: "mow", name: "Mowing" },
  { id: "clean", name: "Cleanup" },
];

describe("planQuoteSplit", () => {
  it("keeps two titled jobs when each line is used once", () => {
    expect(
      planQuoteSplit(lines, [
        { title: " Mow visit ", lineIds: ["mow"] },
        { title: "Cleanup visit", lineIds: ["clean"] },
        { title: "Empty", lineIds: [] },
      ]),
    ).toEqual({
      ok: true,
      groups: [
        { title: "Mow visit", lineIds: ["mow"] },
        { title: "Cleanup visit", lineIds: ["clean"] },
      ],
    });
  });

  it("rejects one job, a repeated line, and an unknown line", () => {
    expect(planQuoteSplit(lines, [{ title: "All", lineIds: ["mow", "clean"] }]).ok).toBe(false);
    expect(
      planQuoteSplit(lines, [
        { title: "A", lineIds: ["mow"] },
        { title: "B", lineIds: ["mow"] },
      ]),
    ).toEqual({ ok: false, error: "A line can only be on one job." });
    expect(
      planQuoteSplit(lines, [
        { title: "A", lineIds: ["mow"] },
        { title: "B", lineIds: ["missing"] },
      ]),
    ).toEqual({ ok: false, error: "A line is not on this quote." });
  });
});
