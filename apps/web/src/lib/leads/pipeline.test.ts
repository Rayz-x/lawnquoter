import { describe, expect, it } from "vitest";
import { advanceLeadStage, leadIsRotting, pipelineColumns, toPipelineCards, type PipelineEvent } from "./pipeline";
import type { LeadStatus } from "./types";

function rot(status: LeadStatus, stageEnteredAt: string, now: string) {
  return leadIsRotting({ status, stageEnteredAt, now: new Date(now), responseTargetMinutes: 60 });
}

describe("advanceLeadStage", () => {
  const cases: [LeadStatus, PipelineEvent, LeadStatus][] = [
    ["new", "contact_logged", "contacted"],
    ["quoted", "contact_logged", "quoted"],
    ["new", "quote_sent", "quoted"],
    ["contacted", "quote_sent", "quoted"],
    ["quoted", "quote_accepted", "won"],
    ["new", "quote_accepted", "won"],
    ["won", "marked_lost", "won"],
    ["won", "quote_sent", "won"],
    ["lost", "quote_accepted", "lost"],
    ["spam", "contact_logged", "spam"],
    ["contacted", "marked_lost", "lost"],
  ];

  it("advances open leads and leaves won, lost, and spam where they are", () => {
    for (const [status, event, next] of cases) {
      expect(advanceLeadStage(status, event), `${status} + ${event}`).toBe(next);
    }
  });
});

describe("leadIsRotting", () => {
  it("rots new at 60 minutes, contacted at 3 days, and quoted at 7 days", () => {
    expect(rot("new", "2026-10-10T11:00:00.000Z", "2026-10-10T12:00:00.000Z")).toBe(true);
    expect(rot("new", "2026-10-10T11:01:00.000Z", "2026-10-10T12:00:00.000Z")).toBe(false);
    expect(rot("contacted", "2026-10-01T12:00:00.000Z", "2026-10-04T12:00:00.000Z")).toBe(true);
    expect(rot("contacted", "2026-10-01T12:01:00.000Z", "2026-10-04T12:00:00.000Z")).toBe(false);
    expect(rot("quoted", "2026-10-01T12:00:00.000Z", "2026-10-08T12:00:00.000Z")).toBe(true);
    expect(rot("quoted", "2026-10-02T12:00:00.000Z", "2026-10-08T12:00:00.000Z")).toBe(false);
    expect(rot("won", "2026-01-01T00:00:00.000Z", "2026-10-10T12:00:00.000Z")).toBe(false);
    expect(rot("lost", "2026-01-01T00:00:00.000Z", "2026-10-10T12:00:00.000Z")).toBe(false);
  });
});

describe("pipelineColumns", () => {
  it("groups cards by stage, flags rotting, shows the owner and lost reason, and drops spam", () => {
    const cards = toPipelineCards(
      [
        {
          id: "a",
          status: "new",
          contact_name: "Ada",
          assignee_name: "Sam",
          lost_reason: null,
          stage_entered_at: "2026-10-10T10:00:00.000Z",
          created_at: "2026-10-10T10:00:00.000Z",
        },
        {
          id: "b",
          status: "lost",
          contact_name: "Bea",
          assignee_name: null,
          lost_reason: "price",
          stage_entered_at: "2026-10-09T12:00:00.000Z",
          created_at: "2026-10-09T12:00:00.000Z",
        },
        {
          id: "c",
          status: "spam",
          contact_name: "Bot",
          assignee_name: null,
          stage_entered_at: "2026-10-01T12:00:00.000Z",
          created_at: "2026-10-01T12:00:00.000Z",
        },
      ],
      new Date("2026-10-10T12:00:00.000Z"),
      60,
    );
    const columns = pipelineColumns(cards);
    expect(columns.map((column) => column.label)).toEqual(["New", "Contacted", "Quoted", "Won", "Lost"]);
    expect(columns[0]?.cards).toEqual([
      { id: "a", name: "Ada", status: "new", ownerName: "Sam", lostReasonLabel: null, rotting: true },
    ]);
    expect(columns[4]?.cards[0]?.lostReasonLabel).toBe("Price");
    expect(cards.some((card) => card.name === "Bot")).toBe(false);
  });
});
