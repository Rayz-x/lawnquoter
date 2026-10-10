import { describe, expect, it } from "vitest";
import {
  ATTENTION_BUCKETS,
  TRAY_BUCKET_LIMIT,
  canAssign,
  canReschedule,
  canSkipOrCancel,
  countBadgeClass,
  emptyAttentionTray,
  trayCounts,
  trayTotal,
  visibleBucketVisits,
  visitIdentityLine,
  type AttentionTray,
  type AttentionVisit,
} from "./attention-tray";

function visit(partial: Partial<AttentionVisit> & Pick<AttentionVisit, "id" | "title" | "status">): AttentionVisit {
  return {
    scheduled_date: null,
    account_name: null,
    address_line1: null,
    city: null,
    budget_minutes: null,
    reason: null,
    property_id: null,
    ...partial,
  };
}

describe("attention tray counts", () => {
  it("matches each bucket length for the schedule tray", () => {
    const tray: AttentionTray = {
      as_of: "2026-10-10",
      counts: { unassigned: 2, overdue: 1, needs_reschedule: 1, flags: 1 },
      unassigned: [
        visit({ id: "a", scheduled_date: null, status: "scheduled", title: "Sales convert" }),
        visit({ id: "b", scheduled_date: "2026-10-11", status: "scheduled", title: "Future open" }),
      ],
      overdue: [visit({ id: "c", scheduled_date: "2026-10-08", status: "scheduled", title: "Late" })],
      needs_reschedule: [visit({ id: "d", scheduled_date: "2026-10-10", status: "skipped", title: "Weather" })],
      flags: [
        visit({
          id: "e",
          scheduled_date: "2026-10-10",
          status: "scheduled",
          title: "Mulch upsell",
          reason: "Upsell: mulch",
        }),
      ],
    };

    expect(trayCounts(tray)).toEqual({
      unassigned: 2,
      overdue: 1,
      needs_reschedule: 1,
      flags: 1,
    });
    expect(trayTotal(trayCounts(tray))).toBe(5);
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

describe("attention tray card copy", () => {
  it("shows account and street as the second line", () => {
    expect(
      visitIdentityLine({ account_name: "Okafor", address_line1: "1503 Larkspur Ln" }),
    ).toBe("Okafor · 1503 Larkspur Ln");
    expect(visitIdentityLine({ account_name: "Okafor", address_line1: null })).toBe("Okafor");
    expect(visitIdentityLine({ account_name: null, address_line1: "1503 Larkspur Ln" })).toBe(
      "Account · 1503 Larkspur Ln",
    );
  });

  it("tints overdue and flags counts when above zero", () => {
    expect(countBadgeClass("overdue", 1)).toContain("bg-warning/15");
    expect(countBadgeClass("flags", 2)).toContain("text-warning");
    expect(countBadgeClass("overdue", 0)).toBe("");
    expect(countBadgeClass("unassigned", 3)).toBe("");
  });

  it("caps a bucket at 50 until expanded", () => {
    const visits = Array.from({ length: 52 }, (_, i) => i);
    expect(visibleBucketVisits(visits, false)).toHaveLength(TRAY_BUCKET_LIMIT);
    expect(visibleBucketVisits(visits, true)).toHaveLength(52);
    expect(visibleBucketVisits(visits.slice(0, 10), false)).toHaveLength(10);
  });

  it("gates assign, skip/cancel, and reschedule by status", () => {
    expect(canAssign("scheduled")).toBe(true);
    expect(canAssign("skipped")).toBe(false);
    expect(canSkipOrCancel("scheduled")).toBe(true);
    expect(canSkipOrCancel("skipped")).toBe(false);
    expect(canReschedule("skipped")).toBe(true);
    expect(canReschedule("cant_complete")).toBe(true);
    expect(canReschedule("scheduled")).toBe(false);
  });
});
