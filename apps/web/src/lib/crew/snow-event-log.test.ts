import { describe, expect, it } from "vitest";
import { snowEventLog } from "./snow-event-log";

describe("snow event log", () => {
  it("keeps trigger depth, start, end, and materials", () => {
    expect(
      snowEventLog({
        triggerIn: 2,
        startedAt: "2026-01-15T06:00:00.000Z",
        endedAt: "2026-01-15T09:30:00.000Z",
        materials: "  salt, 2 bags  ",
      }),
    ).toEqual({
      ok: true,
      log: {
        triggerIn: 2,
        startedAt: "2026-01-15T06:00:00.000Z",
        endedAt: "2026-01-15T09:30:00.000Z",
        materials: "salt, 2 bags",
        minutes: 210,
      },
    });
  });

  it("refuses an end before the start", () => {
    expect(
      snowEventLog({
        triggerIn: 2,
        startedAt: "2026-01-15T09:00:00.000Z",
        endedAt: "2026-01-15T06:00:00.000Z",
        materials: "salt",
      }),
    ).toEqual({ ok: false, error: "The snow event has to end after it starts" });
  });
});
