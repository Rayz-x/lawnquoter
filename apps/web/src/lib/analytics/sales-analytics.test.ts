import { describe, expect, it } from "vitest";
import {
  estimatedVsActual,
  funnelByRep,
  funnelByService,
  funnelBySource,
  marginBy,
  overallFunnel,
  pipelineForecast,
  routeDensity,
  widgetStages,
  winLoss,
  type SalesLead,
} from "./sales-analytics";

function lead(patch: Partial<SalesLead> & Pick<SalesLead, "id" | "status">): SalesLead {
  return {
    source: "Website widget",
    assignee: "Ada",
    service: "Mowing",
    lostReason: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    closedAt: null,
    quotedAt: "2026-06-02T00:00:00.000Z",
    ...patch,
  };
}

const leads: SalesLead[] = [
  lead({
    id: "1",
    status: "won",
    closedAt: "2026-06-05T00:00:00.000Z",
  }),
  lead({
    id: "2",
    status: "lost",
    lostReason: "Price",
    createdAt: "2026-06-02T00:00:00.000Z",
    quotedAt: "2026-06-03T00:00:00.000Z",
  }),
  lead({
    id: "3",
    source: "Referral",
    assignee: null,
    service: null,
    status: "new",
    createdAt: "2026-06-03T00:00:00.000Z",
    quotedAt: null,
  }),
  lead({
    id: "4",
    status: "spam",
    createdAt: "2026-06-04T00:00:00.000Z",
    quotedAt: null,
  }),
];

describe("sales analytics", () => {
  it("counts leads to quoted to accepted by source, excluding spam", () => {
    expect(funnelBySource(leads).find((row) => row.key === "Website widget")).toMatchObject({
      leads: 2,
      quoted: 2,
      accepted: 1,
      quoteRate: 100,
      acceptRate: 50,
      medianDaysToClose: 4,
    });
  });

  it("groups unassigned reps and unspecified services", () => {
    expect(funnelByRep(leads).map((row) => row.key)).toEqual(["Ada", "Unassigned"]);
    expect(funnelByService(leads).some((row) => row.key === "Unspecified")).toBe(true);
  });

  it("counts loss reasons and median first response", () => {
    expect(winLoss(leads)).toEqual([{ reason: "Price", count: 1 }]);
    expect(
      overallFunnel([
        lead({ id: "1", status: "new", quotedAt: null, firstContactedAt: "2026-06-01T00:12:00.000Z" }),
        lead({ id: "2", status: "new", quotedAt: null, firstContactedAt: "2026-05-31T00:00:00.000Z" }),
      ]).medianResponseMinutes,
    ).toBe(12);
  });

  it("forecasts open quotes into the next three months", () => {
    expect(
      pipelineForecast(
        [
          { id: "q1", cents: 1000, createdAt: "2026-06-01", expectedCloseAt: "2026-07-15" },
          { id: "q2", cents: 500, createdAt: "2026-06-02", expectedCloseAt: null },
        ],
        new Date("2026-06-10T00:00:00.000Z"),
      ),
    ).toEqual([
      { month: "2026-06", cents: 500, quotes: 1 },
      { month: "2026-07", cents: 1000, quotes: 1 },
      { month: "2026-08", cents: 0, quotes: 0 },
    ]);
  });

  it("compares hours, widget stages, margin, and postal density", () => {
    expect(estimatedVsActual([{ crew: "North", estimatedMinutes: 120, actualMinutes: 90 }])).toEqual([
      { crew: "North", estimatedHours: 2, actualHours: 1.5, varianceHours: -0.5 },
    ]);
    const stages = widgetStages([
      { addressEntered: true, qualified: true, contactCaptured: true, quoteViewed: false, depositPaid: false },
    ]);
    expect(stages[0]).toEqual({ stage: "Address entered", count: 1, fromStart: 100 });
    expect(stages.at(-1)).toEqual({ stage: "Deposit", count: 0, fromStart: 0 });
    expect(
      marginBy(
        [{ service: "Mowing", crew: "North", revenueCents: 12_000, laborMinutes: 60, laborCostCents: 4_000 }],
        (row) => row.service,
      ),
    ).toEqual([{ key: "Mowing", revenueCents: 12_000, dollarsPerManHour: 120, marginPercent: 67 }]);
    expect(routeDensity([{ postalCode: "75201-1234", status: "new" }, { postalCode: "75201", status: "spam" }])).toEqual([
      { postalCode: "75201", count: 1 },
    ]);
  });
});
