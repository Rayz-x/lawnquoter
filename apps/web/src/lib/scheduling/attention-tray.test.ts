import { describe, expect, it } from "vitest";
import { ATTENTION_BUCKETS, emptyAttentionTray, trayCounts, type AttentionTray } from "./attention-tray";

describe("attention tray counts", () => {
  it("matches each bucket length for the schedule tray", () => {
    const tray: AttentionTray = {
      as_of: "2026-10-10",
      counts: { unassigned: 2, overdue: 1, needs_reschedule: 1, flags: 1 },
      unassigned: [
        { id: "a", scheduled_date: null, status: "scheduled", title: "Sales convert" },
        { id: "b", scheduled_date: "2026-10-11", status: "scheduled", title: "Future open" },
      ],
      overdue: [{ id: "c", scheduled_date: "2026-10-08", status: "scheduled", title: "Late" }],
      needs_reschedule: [{ id: "d", scheduled_date: "2026-10-10", status: "skipped", title: "Weather" }],
      flags: [{ id: "e", scheduled_date: "2026-10-10", status: "scheduled", title: "Mulch upsell" }],
    };

    expect(trayCounts(tray)).toEqual({
      unassigned: 2,
      overdue: 1,
      needs_reschedule: 1,
      flags: 1,
    });
    expect(ATTENTION_BUCKETS.map((bucket) => bucket.key)).toEqual([
      "unassigned",
      "overdue",
      "needs_reschedule",
      "flags",
    ]);
    expect(trayCounts(emptyAttentionTray("2026-10-10"))).toEqual({
      unassigned: 0,
      overdue: 0,
      needs_reschedule: 0,
      flags: 0,
    });
  });
});
