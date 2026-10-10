import { describe, expect, it } from "vitest";
import { correctionPayload, fromLocalInputValue, reasonOk, toLocalInputValue } from "./time-correction";

describe("reasonOk", () => {
  it("requires a non-blank reason", () => {
    expect(reasonOk("")).toBe(false);
    expect(reasonOk("   ")).toBe(false);
    expect(reasonOk(null)).toBe(false);
    expect(reasonOk("Forgot to stop the timer")).toBe(true);
  });
});

describe("local input round-trip", () => {
  it("formats and parses a local datetime value", () => {
    const iso = "2026-10-10T15:30:00.000Z";
    const local = toLocalInputValue(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const back = fromLocalInputValue(local);
    expect(back).toBeTruthy();
    expect(Date.parse(back!)).toBe(Date.parse(local));
  });
});

describe("correctionPayload", () => {
  it("rejects missing reason or times", () => {
    expect(correctionPayload({ startedAt: "2026-10-10T15:00:00.000Z", completedAt: null, reason: "" })).toBeNull();
    expect(correctionPayload({ startedAt: null, completedAt: null, reason: "oops" })).toBeNull();
  });

  it("rejects finish before start", () => {
    expect(
      correctionPayload({
        startedAt: "2026-10-10T16:00:00.000Z",
        completedAt: "2026-10-10T15:00:00.000Z",
        reason: "backwards",
      }),
    ).toBeNull();
  });

  it("builds a sync payload with trimmed reason", () => {
    expect(
      correctionPayload({
        startedAt: "2026-10-10T15:00:00.000Z",
        completedAt: "2026-10-10T15:20:00.000Z",
        reason: "  Gate wait  ",
      }),
    ).toEqual({
      started_at: "2026-10-10T15:00:00.000Z",
      completed_at: "2026-10-10T15:20:00.000Z",
      reason: "Gate wait",
    });
  });
});
