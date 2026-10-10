import { describe, expect, it } from "vitest";
import {
  hasSeasonalWindow,
  isSeasonalWarnRed,
  seasonalWarnBadgeLabel,
  seasonalWarnState,
} from "./seasonal-window";

const aeration = {
  windowStart: "2026-09-01",
  windowEnd: "2026-10-31",
  warnDate: "2026-10-01",
};

describe("seasonalWarnState", () => {
  it("is none when the service has no window", () => {
    expect(
      seasonalWarnState({
        asOf: "2026-10-10",
        window: { windowStart: null, windowEnd: null, warnDate: null },
        scheduled: false,
      }),
    ).toBe("none");
    expect(hasSeasonalWindow({ windowStart: "2026-09-01", windowEnd: null, warnDate: "2026-10-01" })).toBe(
      false,
    );
  });

  it("is ok before the warn date while unscheduled", () => {
    expect(
      seasonalWarnState({
        asOf: "2026-09-15",
        window: aeration,
        scheduled: false,
      }),
    ).toBe("ok");
    expect(
      isSeasonalWarnRed(
        seasonalWarnState({ asOf: "2026-09-15", window: aeration, scheduled: false }),
      ),
    ).toBe(false);
  });

  it("turns warn (red) on and after the warn date while unscheduled", () => {
    expect(
      seasonalWarnState({
        asOf: "2026-10-01",
        window: aeration,
        scheduled: false,
      }),
    ).toBe("warn");
    expect(
      seasonalWarnState({
        asOf: "2026-10-15",
        window: aeration,
        scheduled: false,
      }),
    ).toBe("warn");
    expect(
      isSeasonalWarnRed(
        seasonalWarnState({ asOf: "2026-10-15", window: aeration, scheduled: false }),
      ),
    ).toBe(true);
    expect(
      seasonalWarnBadgeLabel(
        seasonalWarnState({ asOf: "2026-10-15", window: aeration, scheduled: false }),
      ),
    ).toBe("Past warn date");
  });

  it("clears the warning once the job is scheduled", () => {
    expect(
      seasonalWarnState({
        asOf: "2026-10-15",
        window: aeration,
        scheduled: true,
      }),
    ).toBe("cleared");
    expect(
      isSeasonalWarnRed(
        seasonalWarnState({ asOf: "2026-10-15", window: aeration, scheduled: true }),
      ),
    ).toBe(false);
    expect(
      seasonalWarnBadgeLabel(
        seasonalWarnState({ asOf: "2026-10-15", window: aeration, scheduled: true }),
      ),
    ).toBeNull();
  });
});
