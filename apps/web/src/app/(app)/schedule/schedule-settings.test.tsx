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
    expect(closed).not.toContain("Activate snow");
    expect(closed).not.toContain("Help for weather rules");

    const html = renderToStaticMarkup(
      createElement(ScheduleSettingsPanel, { date: "2026-12-01", rules: [] }),
    );
    expect(html).toContain("Help for weather rules");
    expect(html).toContain("Help for the weather threshold");
    expect(html).toContain("Help for snow events");
    expect(html).toContain("Help for snow depth");
    expect(html).not.toContain("Which kind of weather this rule watches.");
    expect(html).not.toContain("Rainfall to check, in inches.");
  });
});
