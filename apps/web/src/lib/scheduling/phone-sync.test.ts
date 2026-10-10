import { describe, expect, it } from "vitest";
import { boardPhonesForCrew, phoneSyncStatus } from "./phone-sync";

describe("boardPhonesForCrew", () => {
  it("lists every member and keeps Never synced until they ack", () => {
    const syncByProfile = new Map([
      ["p2", { packVersion: 2, lastSyncedAt: "2026-10-09T14:31:00.000Z" }],
    ]);
    expect(
      boardPhonesForCrew({
        members: [
          { profileId: "p1", name: "Ana" },
          { profileId: "p2", name: "Bo" },
        ],
        syncByProfile,
      }),
    ).toEqual([
      { profileId: "p1", name: "Ana", packVersion: null, lastSyncedAt: null, revokedAt: null, unsynced: [] },
      {
        profileId: "p2",
        name: "Bo",
        packVersion: 2,
        lastSyncedAt: "2026-10-09T14:31:00.000Z",
        revokedAt: null,
        unsynced: [],
      },
    ]);
  });

  it("attaches revoke snapshots so the office can chase unsynced starts", () => {
    expect(
      boardPhonesForCrew({
        members: [{ profileId: "p1", name: "Ana" }],
        syncByProfile: new Map(),
        revokeByProfile: new Map([
          [
            "p1",
            {
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
            },
          ],
        ]),
      }),
    ).toMatchObject([
      {
        profileId: "p1",
        revokedAt: "2026-10-09T15:00:00.000Z",
        unsynced: [{ id: "v1", title: "Mow" }],
      },
    ]);
  });
});

describe("phoneSyncStatus", () => {
  const now = new Date("2026-10-09T15:00:00.000Z");

  it("marks never-synced phones instead of a blank No contact since", () => {
    expect(
      phoneSyncStatus({
        phoneName: "Ana",
        packVersion: null,
        routeVersion: 3,
        lastSyncedAt: null,
        now,
      }),
    ).toEqual({
      versionLabel: "Route v3",
      syncLabel: "Never synced",
      attention: true,
    });
  });

  it("keeps a healthy sync muted and names the route version", () => {
    expect(
      phoneSyncStatus({
        phoneName: "Ana",
        packVersion: 2,
        routeVersion: 2,
        lastSyncedAt: "2026-10-09T14:31:00.000Z",
        now,
        timeZone: "UTC",
      }),
    ).toEqual({
      versionLabel: "Route v2",
      syncLabel: "Last synced 2:31 PM",
      attention: false,
    });
  });

  it("flags stale contact and a phone behind the published route", () => {
    expect(
      phoneSyncStatus({
        phoneName: "Ana",
        packVersion: 2,
        routeVersion: 3,
        lastSyncedAt: "2026-10-09T13:00:00.000Z",
        now,
        timeZone: "UTC",
      }),
    ).toEqual({
      versionLabel: "Route v3 · Ana has v2",
      syncLabel: "No contact since 1:00 PM",
      attention: true,
    });
  });
});
