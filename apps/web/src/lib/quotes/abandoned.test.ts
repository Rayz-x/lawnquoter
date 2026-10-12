import { describe, expect, it } from "vitest";
import { isAbandonedQuote } from "./abandoned";

const viewed = "2026-10-02T12:00:00.000Z";
const day = (iso: string) => Date.parse(iso);

describe("abandoned quotes", () => {
  it("is a viewed quote with no reply and no decision after two days", () => {
    const base = { status: "viewed", viewedAt: viewed, replied: false, alreadySent: false, asOfMs: day("2026-10-04T12:00:00.000Z") };
    expect(isAbandonedQuote(base)).toBe(true);
    expect(isAbandonedQuote({ ...base, asOfMs: day("2026-10-03T12:00:00.000Z") })).toBe(false);
    expect(isAbandonedQuote({ ...base, replied: true })).toBe(false);
    expect(isAbandonedQuote({ ...base, status: "accepted" })).toBe(false);
    expect(isAbandonedQuote({ ...base, status: "sent", viewedAt: null })).toBe(false);
    expect(isAbandonedQuote({ ...base, alreadySent: true })).toBe(false);
  });
});
