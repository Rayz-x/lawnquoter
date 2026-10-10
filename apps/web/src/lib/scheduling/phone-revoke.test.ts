import { describe, expect, it } from "vitest";
import { parseRevokePhoneResult, unsyncedVisitLabel } from "./phone-revoke";

describe("parseRevokePhoneResult", () => {
  it("lists started-but-unsynced visits from the revoke RPC", () => {
    expect(
      parseRevokePhoneResult({
        profile_id: "p1",
        revoked_at: "2026-10-09T15:00:00.000Z",
        unsynced_visits: [
          {
            id: "v1",
            title: "Mow",
            address: "1503 Larkspur",
            status: "in_progress",
            scheduled_date: "2026-10-09",
          },
          { id: "bad" },
        ],
      }),
    ).toEqual({
      profileId: "p1",
      revokedAt: "2026-10-09T15:00:00.000Z",
      unsynced: [
        {
          id: "v1",
          title: "Mow",
          address: "1503 Larkspur",
          status: "in_progress",
          scheduledDate: "2026-10-09",
        },
      ],
    });
  });
});

describe("unsyncedVisitLabel", () => {
  it("names the open visits the office must chase after revoke", () => {
    expect(unsyncedVisitLabel(0)).toBe("No started visits waiting on this phone");
    expect(unsyncedVisitLabel(1)).toBe("1 visit started but unsynced on this phone");
    expect(unsyncedVisitLabel(3)).toBe("3 visits started but unsynced on this phone");
  });
});
