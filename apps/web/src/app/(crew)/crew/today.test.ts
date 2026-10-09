import { describe, expect, it } from "vitest";
import {
  dayHeading,
  driveUrl,
  finishLabel,
  listRows,
  newStopIds,
  officeTel,
  packErrorMessage,
  parseDayPack,
  progressLabel,
  routeUpdateMessage,
  syncPill,
} from "./today";

const pack = {
  date: "2026-10-09",
  crew: { id: "c1", name: "North" },
  office: { name: "Prairie Mow", phone: "217-555-0140" },
  route: { id: "r1", date: "2026-10-09", status: "published", revision: 2 },
  visits: [
    visit("v1", "completed", 1, { budget_minutes: 20 }),
    visit("v2", "skipped", 2, { skip_reason: "Weather", budget_minutes: 30 }),
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
});

describe("day list rows", () => {
  const stops = parseDayPack(pack)?.stops ?? [];

  it("collapses finished stops and keeps the next open stop", () => {
    expect(listRows(stops)).toMatchObject({
      done: [{ id: "v1" }],
      upNext: { id: "v3" },
      rest: [{ id: "v2" }],
    });
    expect(progressLabel(stops)).toBe("1 of 3 stops done");
    expect(finishLabel(stops, new Date("2026-10-09T15:00:00.000Z"))).toMatch(/^Finish ≈ /);
    expect(finishLabel([{ ...stops[0]!, status: "completed" }], new Date())).toBeNull();
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
    expect(routeUpdateMessage([8], new Date("2026-10-09T14:31:00.000Z"))).toMatch(/Route updated .*stop 8 added/);
    expect(packErrorMessage("not allowed")).toBe("Ask the office to add you to a crew.");
  });
});
