import { describe, expect, it } from "vitest";
import { allowClick, openQuotesByService, tierSaveOptions } from "./pricing-entry";

const line = (service_id: string) => ({ service_id });

describe("pricing entry", () => {
  it("counts only the current version of an open quote", () => {
    const counts = openQuotesByService([
      { id: "q1", status: "sent", current_version: 2, quote_versions: [{ version: 1, quote_line_items: [line("s1")] }, { version: 2, quote_line_items: [line("s1"), line("s2")] }] },
      { id: "q2", status: "accepted", current_version: 1, quote_versions: [{ version: 1, quote_line_items: [line("s1")] }] },
    ]);
    expect(counts.get("s1")?.size).toBe(1);
    expect(counts.get("s2")?.size).toBe(1);
  });
  it("keeps typed tier values and blocks a double-click", () => {
    expect(tierSaveOptions(false)).toEqual({ immediate: false, rollback: false });
    const lock = { at: 0 };
    expect(allowClick(lock, 1000)).toBe(true);
    expect(allowClick(lock, 1200)).toBe(false);
  });
});
