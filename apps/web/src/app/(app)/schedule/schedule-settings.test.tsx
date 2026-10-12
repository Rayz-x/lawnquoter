import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ScheduleSettings, ScheduleSettingsPanel } from "./schedule-settings";

describe("schedule settings", () => {
  it("keeps weather rules and snow activation off the board until the gear is opened", () => {
    const closed = renderToStaticMarkup(
      createElement(ScheduleSettings, { date: "2026-12-01", rules: [] }),
    );
    expect(closed).toContain("Schedule settings");
    expect(closed).toContain("Open weather rules and snow events.");
    expect(closed).not.toContain("Which kind of weather this rule watches.");
    expect(closed).not.toContain("Activate snow");

    const html = renderToStaticMarkup(
      createElement(ScheduleSettingsPanel, { date: "2026-12-01", rules: [] }),
    );
    expect(html).toContain("Which kind of weather this rule watches.");
    expect(html).toContain("Skip takes the stops off this day.");
    expect(html).toContain("How much has to happen before the rule runs.");
    expect(html).toContain("Stores this rule. It does not change today’s stops.");
    expect(html).toContain("Rainfall to check, in inches.");
    expect(html).toContain("Snowfall to check, in inches.");
    expect(html).toContain("Wind to check, in miles per hour.");
    expect(html).toContain("Temperature to check, in degrees Fahrenheit.");
    expect(html).toContain("Runs the matching rule on this day’s stops.");
    expect(html).toContain("How much snow fell. Agreements at or under this depth get a visit.");
    expect(html).toContain("Schedules one visit for each snow agreement that is not already on this day.");
    expect(html).toContain("The crew logs materials and times on the visit.");
  });
});
