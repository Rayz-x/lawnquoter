import { describe, expect, it, vi } from "vitest";
import {
  isLeadStale,
  selectFollowUpsForDigest,
  sendAssigneeDigests,
  type DigestLead,
} from "./follow-up-digest";

function lead(partial: Partial<DigestLead> & Pick<DigestLead, "id">): DigestLead {
  return {
    orgId: "org-1",
    assigneeId: "user-a",
    assigneeEmail: "a@example.com",
    nextFollowUpOn: "2026-10-10",
    lastActivityAt: "2026-10-01T12:00:00.000Z",
    status: "new",
    contactName: "Pat",
    ...partial,
  };
}

describe("selectFollowUpsForDigest", () => {
  it("returns exactly due and overdue for the given date", () => {
    const asOf = "2026-10-10";
    const rows = [
      lead({ id: "due", nextFollowUpOn: "2026-10-10" }),
      lead({ id: "overdue", nextFollowUpOn: "2026-10-08" }),
      lead({ id: "future", nextFollowUpOn: "2026-10-11" }),
      lead({ id: "none", nextFollowUpOn: null }),
      lead({ id: "spam", nextFollowUpOn: "2026-10-09", status: "spam" }),
      lead({ id: "won", nextFollowUpOn: "2026-10-09", status: "won" }),
    ];

    const selected = selectFollowUpsForDigest(rows, asOf);
    expect(selected.map((row) => row.id).sort()).toEqual(["due", "overdue"]);
  });
});

describe("sendAssigneeDigests", () => {
  it("sends one digest per assignee and skips duplicates on rerun", async () => {
    const asOf = "2026-10-10";
    const rows = [
      lead({ id: "1", assigneeId: "user-a", assigneeEmail: "a@example.com", nextFollowUpOn: "2026-10-10" }),
      lead({ id: "2", assigneeId: "user-a", assigneeEmail: "a@example.com", nextFollowUpOn: "2026-10-08" }),
      lead({ id: "3", assigneeId: "user-b", assigneeEmail: "b@example.com", nextFollowUpOn: "2026-10-10" }),
    ];
    const sentKeys = new Set<string>();
    const send = vi.fn(async () => ({ id: "msg", sent: true }));

    const first = await sendAssigneeDigests({
      leads: rows,
      asOfDate: asOf,
      sentKeys,
      send,
      orgName: "Lawn Co",
    });
    expect(first.sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);

    const second = await sendAssigneeDigests({
      leads: rows,
      asOfDate: asOf,
      sentKeys,
      send,
      orgName: "Lawn Co",
    });
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("isLeadStale", () => {
  it("is stale at day 7, not day 6", () => {
    const lastActivityAt = "2026-10-01T15:30:00.000Z";
    expect(isLeadStale(lastActivityAt, "2026-10-07")).toBe(false);
    expect(isLeadStale(lastActivityAt, "2026-10-08")).toBe(true);
  });
});
