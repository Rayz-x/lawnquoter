import { describe, expect, it } from "vitest";
import { orgToday } from "@/lib/scheduling/office-date";
import {
  dayHeading,
  driveUrl,
  finishLabel,
  listRows,
  newStopIds,
  officeTel,
  offlineDayPack,
  packErrorMessage,
  packIsFresh,
  packRequestDate,
  parseDayPack,
  pickOfflinePack,
  progressLabel,
  crewStatusBanner,
  routeDayBanner,
  routeDayBannerText,
  routeUpdateMessage,
  shouldCloseOpenVisit,
  syncPill,
} from "./today";

const pack = {
  date: "2026-10-09",
  server_today: "2026-10-09",
  version: 2,
  crew: { id: "c1", name: "North" },
  office: { name: "Prairie Mow", phone: "217-555-0140" },
  route: { id: "r1", date: "2026-10-09", status: "published", revision: 2 },
  visits: [
    visit("v1", "completed", 1, { budget_minutes: 20 }),
    visit("v2", "skipped", 2, { skip_reason: "weather", budget_minutes: 30 }),
    visit("v3", "scheduled", 3, {
      budget_minutes: 35,
      property: property({ gate_code: "4815", gate_width_in: 36, has_dogs: true, has_stairs: true, slope: "steep", lat: 40.1, lng: -89.2 }),
    }),
  ],
};

function visit(id: string, status: string, sort: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    sort,
    status,
    title: id === "v3" ? "Weekly mow" : "Cleanup",
    budget_minutes: null,
    skip_reason: null,
    property: property(),
    tasks: [{ label: "Edge" }],
    photos: [],
    plan: [],
    ...extra,
  };
}

function property(extra: Record<string, unknown> = {}) {
  return {
    formatted_address: "1503 Larkspur",
    last_name: "Hollis",
    gate_code: null,
    gate_width_in: 60,
    has_dogs: false,
    has_stairs: false,
    slope: "flat",
    lat: null,
    lng: null,
    ...extra,
  };
}

describe("parseDayPack", () => {
  it("builds the route list without the gate code or prices", () => {
    const view = parseDayPack(pack);
    expect(view?.crewName).toBe("North");
    expect(view?.crewId).toBe("c1");
    expect(view?.serverToday).toBe("2026-10-09");
    expect(view?.version).toBe(2);
    expect(view?.officePhone).toBe("217-555-0140");
    expect(view?.stops.map((stop) => stop.number)).toEqual([1, 2, 3]);
    expect(view?.stops[2]).toMatchObject({
      title: "Weekly mow",
      lastName: "Hollis",
      address: "1503 Larkspur",
      lat: 40.1,
      chips: [
        { label: "Gate code", warning: false },
        { label: "Dog", warning: true },
        { label: "36″ gate", warning: true },
        { label: "Steep", warning: true },
        { label: "Stairs", warning: true },
      ],
    });
    const encoded = JSON.stringify(view);
    expect(encoded).not.toContain("4815");
    expect(encoded).not.toMatch(/price|cost|margin|email/i);
    expect(parseDayPack(null)).toBeNull();
  });

  it("labels a zero gate width as No gate without a warning", () => {
    const view = parseDayPack({
      ...pack,
      visits: [visit("v4", "scheduled", 1, { property: property({ gate_width_in: 0 }) })],
    });
    expect(view?.stops[0]?.chips).toEqual([{ label: "No gate", warning: false }]);
  });
});

describe("day list rows", () => {
  const stops = parseDayPack(pack)?.stops ?? [];

  it("collapses finished stops and keeps the next open stop", () => {
    expect(listRows(stops)).toMatchObject({
      done: [{ id: "v1" }],
      upNext: { id: "v3" },
      rest: [{ id: "v2" }],
    });
    const active = { ...stops[2]!, id: "active", status: "in_progress", number: 4, startedAt: "2026-10-09T14:00:00.000Z", budgetMinutes: 40 };
    expect(stops[1]?.skipReason).toBe("Weather");
    expect(progressLabel(stops)).toBe("1 of 3 stops done");
    expect(listRows([stops[2]!, { ...active, startedAt: "2026-10-09T14:30:00.000Z" }]).upNext?.id).toBe("active");
    expect(finishLabel(stops, new Date("2026-10-09T15:00:00.000Z"))).toMatch(/^Finish ≈ /);
    expect(finishLabel([{ ...stops[0]!, status: "completed" }], new Date())).toBeNull();
    expect(finishLabel([active], new Date("2026-10-09T15:00:00.000Z"))).toBe("Running late");
  });

  it("describes sync, driving, and a route change", () => {
    expect(syncPill(0, false)).toBe("Synced");
    expect(syncPill(2, false)).toBe("2 waiting");
    expect(syncPill(2, true)).toBe("Sending…");
    expect(driveUrl(40.1, -89.2, true)).toContain("maps.apple.com");
    expect(driveUrl(40.1, -89.2, false)).toContain("google.com/maps");
    expect(officeTel("217-555-0140")).toBe("tel:2175550140");
    expect(dayHeading("2026-10-09")).toContain("Oct");
    expect(newStopIds(["v1"], ["v1", "v8"])).toEqual(["v8"]);
    const at = new Date("2026-10-09T14:31:00.000Z");
    expect(routeUpdateMessage([8], [], at)).toMatch(/Route updated .*stop 8 added/);
    expect(routeUpdateMessage([], [4], at)).toMatch(/stop 4 removed/);
    expect(routeUpdateMessage([8], [], at)).not.toMatch(/0 removed/);
    expect(packErrorMessage("not allowed")).toBe("Ask the office to add you to a crew.");
    expect(shouldCloseOpenVisit("v3", ["v1", "v2", "v3"], ["v3", "v1", "v2"])).toBe(false);
    expect(shouldCloseOpenVisit("v3", ["v1", "v3"], ["v1"])).toBe(true);
    const morning = new Date("2026-10-09T13:30:00.000Z");
    expect(orgToday("America/Chicago", new Date("2026-10-09T04:30:00.000Z"))).toBe("2026-10-08");
    expect(orgToday("America/Chicago", morning)).toBe("2026-10-09");
    expect(packIsFresh("2026-10-07T12:00:00.000Z", morning)).toBe(false);
    expect(offlineDayPack({ date: "2026-10-08", savedAt: morning.toISOString() }, "2026-10-09", morning)?.date).toBe("2026-10-08");
    expect(offlineDayPack({ date: "2026-10-09", savedAt: morning.toISOString() }, "2026-10-09", morning)?.date).toBe("2026-10-09");
    expect(offlineDayPack({ date: "2026-10-10", savedAt: morning.toISOString() }, "2026-10-09", morning)).toBeNull();
  });
});

describe("stale pack and clock mismatch", () => {
  const morning = new Date("2026-10-09T13:30:00.000Z");

  it("shows Yesterday's route for a stale offline pack", () => {
    expect(routeDayBanner("2026-10-08", "2026-10-09")).toBe("yesterday");
    expect(routeDayBannerText("yesterday")).toBe("Yesterday's route");
    expect(routeDayBanner("2026-10-07", "2026-10-09")).toBe("mismatch");
    expect(routeDayBanner("2026-10-10", "2026-10-09")).toBe("mismatch");
    expect(routeDayBannerText("mismatch", "2026-10-09")).toBe(
      "Your phone's date looks wrong. Showing the office's route for Fri Oct 9.",
    );
    expect(routeDayBanner("2026-10-09", "2026-10-09")).toBeNull();
    // Fast phone clock + org-correct pack → mismatch, not Yesterday's route.
    expect(routeDayBanner("2026-10-09", "2026-10-10", "2026-10-09")).toBe("mismatch");
    expect(
      pickOfflinePack(
        [
          { date: "2026-10-08", saved_at: "2026-10-08T20:00:00.000Z", pack: { n: 1 } },
          { date: "2026-10-10", saved_at: morning.toISOString(), pack: { n: 2 } },
        ],
        "2026-10-09",
        morning,
      )?.date,
    ).toBe("2026-10-08");
    expect(packRequestDate("2026-10-10", "2026-10-09")).toBe("2026-10-09");
    expect(packRequestDate("2026-10-09", "2026-10-09")).toBe("2026-10-09");
  });

  it("merges no-signal with Yesterday's route into one banner", () => {
    expect(crewStatusBanner(true, null)).toBeNull();
    expect(crewStatusBanner(true, "yesterday")).toBe("Yesterday's route");
    expect(crewStatusBanner(true, "mismatch", "2026-10-09")).toBe(
      "Your phone's date looks wrong. Showing the office's route for Fri Oct 9.",
    );
    expect(crewStatusBanner(false, null)).toBe("No signal. Your work is saved on this phone.");
    expect(crewStatusBanner(false, "yesterday")).toBe(
      "No signal · Yesterday's route. Pull to refresh when you have signal.",
    );
  });
});
