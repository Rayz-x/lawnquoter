import { describe, expect, it } from "vitest";
import { isGoneQuiet } from "./gone-quiet";

const sent = "2026-10-01T12:00:00.000Z";
const day = (iso: string) => Date.parse(iso);

describe("quote gone quiet", () => {
  it("flags a sent quote with no view and no reply after three days", () => {
    expect(isGoneQuiet({ status: "sent", sentAt: sent, viewedAt: null, replied: false, asOfMs: day("2026-10-04T12:00:00.000Z") })).toBe(true);
    expect(isGoneQuiet({ status: "sent", sentAt: sent, viewedAt: null, replied: false, asOfMs: day("2026-10-03T12:00:00.000Z") })).toBe(false);
    expect(isGoneQuiet({ status: "sent", sentAt: sent, viewedAt: "2026-10-02T12:00:00.000Z", replied: false, asOfMs: day("2026-10-08T12:00:00.000Z") })).toBe(false);
    expect(isGoneQuiet({ status: "sent", sentAt: sent, viewedAt: null, replied: true, asOfMs: day("2026-10-08T12:00:00.000Z") })).toBe(false);
    expect(isGoneQuiet({ status: "viewed", sentAt: sent, viewedAt: null, replied: false, asOfMs: day("2026-10-08T12:00:00.000Z") })).toBe(false);
  });
});
