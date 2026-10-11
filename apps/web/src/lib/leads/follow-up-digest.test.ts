import { describe, expect, it } from "vitest";
import { selectFollowUpsForDigest, type DigestLead } from "./follow-up-digest";

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
