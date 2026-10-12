import { describe, expect, it } from "vitest";
import { parseDispatchView, scheduleHref, shouldMoveVisit, weekDates } from "./dispatch-view";

describe("dispatch views", () => {
  it("keeps an unknown view on the day board", () => {
    expect(parseDispatchView(undefined)).toBe("day");
    expect(parseDispatchView("month")).toBe("day");
    expect(parseDispatchView("week")).toBe("week");
    expect(parseDispatchView("crew")).toBe("crew");
  });

  it("builds a seven-day span from the selected day", () => {
    expect(weekDates("2026-10-12")).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
  });

  it("keeps the view and crew on the schedule link", () => {
    expect(scheduleHref("2026-10-12", "day")).toBe("/schedule?date=2026-10-12");
    expect(scheduleHref("2026-10-12", "crew", "crew-1")).toBe("/schedule?date=2026-10-12&view=crew&crew=crew-1");
  });

  it("ignores a drop onto the same crew and day", () => {
    expect(shouldMoveVisit({ crewId: "c", date: "2026-10-12" }, { crewId: "c", date: "2026-10-12" })).toBe(false);
    expect(shouldMoveVisit({ crewId: "c", date: "2026-10-12" }, { crewId: "c", date: "2026-10-13" })).toBe(true);
    expect(shouldMoveVisit({ crewId: "a", date: "2026-10-12" }, { crewId: "b", date: "2026-10-12" })).toBe(true);
    expect(shouldMoveVisit({ crewId: null, date: "2026-10-12" }, { crewId: "c", date: "2026-10-12" })).toBe(true);
  });
});
