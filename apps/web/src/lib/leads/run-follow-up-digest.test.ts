import { describe, expect, it, vi } from "vitest";
import type { DigestLead } from "./follow-up-digest";
import { runFollowUpDigestJob, type FollowUpDigestStore } from "./run-follow-up-digest";

describe("runFollowUpDigestJob", () => {
  it("sends only during the company 7 AM hour and respects claims", async () => {
    const leads: DigestLead[] = [
      {
        id: "l1",
        orgId: "org-1",
        assigneeId: "user-a",
        assigneeEmail: "a@example.com",
        nextFollowUpOn: "2026-10-10",
        lastActivityAt: "2026-10-01T00:00:00.000Z",
        status: "new",
        contactName: "Pat",
      },
    ];
    const claims: string[] = [];
    const store: FollowUpDigestStore = {
      async listOrgs() {
        return [{ id: "org-1", name: "Lawn Co", timezone: "America/Chicago" }];
      },
      async listFollowUpLeads() {
        return leads;
      },
      async listSentKeys() {
        return new Set();
      },
      async claimDigest(_orgId, assigneeId, asOfDate) {
        const key = `${assigneeId}:${asOfDate}`;
        if (claims.includes(key)) return false;
        claims.push(key);
        return true;
      },
    };
    const send = vi.fn(async () => ({ id: "1", sent: true }));

    // 2026-10-10 12:00 UTC = 7:00 America/Chicago (CDT, UTC-5).
    const atSeven = new Date("2026-10-10T12:00:00.000Z");
    const first = await runFollowUpDigestJob({ store, now: atSeven, send });
    expect(first.orgsConsidered).toBe(1);
    expect(first.digestsSent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    const second = await runFollowUpDigestJob({ store, now: atSeven, send });
    expect(second.digestsSent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);

    const atEight = new Date("2026-10-10T13:00:00.000Z");
    const offHour = await runFollowUpDigestJob({ store, now: atEight, send });
    expect(offHour.orgsConsidered).toBe(0);
  });
});
