import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { emptyAttentionTray } from "@/lib/scheduling/attention-tray";
import { DayBoard, type BoardColumn } from "./day-board";

const column: BoardColumn = {
  crewId: "crew",
  crewName: "North",
  routeId: "route",
  routeStatus: "draft",
  routeVersion: 1,
  phones: [],
  visits: [
    {
      id: "visit",
      title: "Mow",
      customer: "Ada",
      address: "1 Main",
      status: "scheduled",
      scheduledDate: "2026-06-01",
      overdue: false,
      budgetMinutes: 30,
      driveMinutes: null,
      windowLabel: null,
    },
  ],
  presence: null,
};

describe("day board help", () => {
  it("shows rain day and routing tips on the main view even with one stop", () => {
    const html = renderToStaticMarkup(
      createElement(DayBoard, {
        date: "2026-06-01",
        canWrite: true,
        timeZone: "America/Chicago",
        saturdayWorkday: false,
        paidRouting: false,
        tray: emptyAttentionTray("2026-06-01"),
        columns: [column],
      }),
    );
    expect(html).toContain("Help for rain day");
    expect(html).toContain("Help for routing");
    expect(html).toContain("Rain day");
    expect(html).not.toContain("Reorder by drive time");
  });
});
