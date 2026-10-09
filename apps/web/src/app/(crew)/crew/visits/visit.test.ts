import { describe, expect, it } from "vitest";
import { activeAddress, applyClock, budgetLabel, cachedLiveLead, elapsedMs, formatElapsed, isLiveCrewLead, leadFromReads, patchVisitPack, projectVisit, readClock, rememberLiveLead, saveLeadForPack, visitFromPack, writeClock, type VisitClock } from "./visit";

const at = "2026-10-09T14:00:00.000Z";
const pack = {
  date: "2026-10-09",
  visits: [
    { id: "v1", status: "scheduled", title: "Weekly mow", budget_minutes: 35, crew_size: 2, crew_note: "Leave the gate open", property: { formatted_address: "1503 Larkspur", last_name: "Hollis", gate_code: "4815", gate_width_in: 36, has_dogs: true, access_notes: "Side gate", crew_notes: "Watch the bed by the drive", lat: 40.1, lng: -89.2 }, tasks: [{ label: "Mow", quantity_text: "6,840 sq ft", notes_crew: "edge the walk" }] },
    { id: "v2", status: "in_progress", title: "Cleanup", started_at: "2026-10-09T13:00:00.000Z", property: { formatted_address: "88 Oak" }, tasks: [] },
  ],
};
const blank: VisitClock = { status: "scheduled", startedAt: null, crewSize: 2, segments: [], applied: [] };

describe("visit detail timer", () => {
  it("shows the gate code and notes without prices", () => {
    const visit = visitFromPack(pack, "v1");
    expect(visit).toMatchObject({ address: "1503 Larkspur", lastName: "Hollis", gateCode: "4815", accessNotes: "Side gate", officeNotes: "Watch the bed by the drive", crewNote: "Leave the gate open", budgetMinutes: 35, number: 1, hasDogs: true });
    expect(visit?.tasks).toEqual([{ label: "Mow", quantity: "6,840 sq ft", note: "edge the walk" }]);
    expect(JSON.stringify(visit)).not.toMatch(/price|margin/);
    expect(visitFromPack(pack, "missing")).toBeNull();
  });

  it("counts job time and leaves a pause out", () => {
    const segments: VisitClock["segments"] = [
      { kind: "job", startedAt: "2026-10-09T13:00:00.000Z", endedAt: "2026-10-09T13:10:00.000Z" },
      { kind: "pause", startedAt: "2026-10-09T13:10:00.000Z", endedAt: "2026-10-09T13:15:00.000Z" },
      { kind: "job", startedAt: "2026-10-09T13:15:00.000Z", endedAt: null },
    ];
    expect(elapsedMs(segments, new Date("2026-10-09T13:18:00.000Z"))).toBe(13 * 60_000);
    const paused = [{ kind: "job" as const, startedAt: "2026-10-09T13:00:00.000Z", endedAt: "2026-10-09T13:10:00.000Z" }, { kind: "pause" as const, startedAt: "2026-10-09T13:10:00.000Z", endedAt: null }];
    expect(elapsedMs(paused, new Date("2026-10-09T14:00:00.000Z"))).toBe(10 * 60_000);
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(35 * 60_000 + 4_000)).toBe("35:04");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(budgetLabel(39 * 60_000, 35)).toBe("Over by 4 min");
    expect(budgetLabel(10 * 60_000, 35)).toBeNull();
  });

  it("starts, pauses, resumes, and finishes from timestamps", () => {
    let clock = applyClock(blank, { clientId: "a", kind: "visit_start", at });
    clock = applyClock(clock, { clientId: "b", kind: "visit_pause", at: "2026-10-09T14:10:00.000Z" });
    clock = applyClock(clock, { clientId: "c", kind: "visit_resume", at: "2026-10-09T14:20:00.000Z" });
    clock = applyClock(clock, { clientId: "d", kind: "visit_finish", at: "2026-10-09T14:25:00.000Z" });
    expect(clock.status).toBe("completed");
    expect(elapsedMs(clock.segments, new Date("2026-10-09T16:00:00.000Z"))).toBe(15 * 60_000);
    expect(applyClock(clock, { clientId: "b", kind: "visit_pause", at: "2026-10-09T14:10:00.000Z" })).toBe(clock);
    expect(applyClock(blank, { clientId: "f", kind: "visit_finish", at }).status).toBe("scheduled");
    const running = applyClock(blank, { clientId: "s", kind: "visit_start", at });
    expect(applyClock(running, { clientId: "s2", kind: "visit_start", at }).segments).toHaveLength(1);
    expect(applyClock(running, { clientId: "n", kind: "visit_set_crew_size", at, crewSize: 4 }).crewSize).toBe(4);
    expect(applyClock(running, { clientId: "n2", kind: "visit_set_crew_size", at, crewSize: 0 }).crewSize).toBe(2);
  });

  it("keeps a pending pause and a stored clock", () => {
    const running = visitFromPack(pack, "v2")!;
    const paused = projectVisit(running, null, [{ kind: "job", startedAt: "2026-10-09T13:00:00.000Z", endedAt: null }], [{ clientId: "p", kind: "visit_pause", at: "2026-10-09T13:40:00.000Z" }]);
    expect(paused.status).toBe("paused");
    expect(elapsedMs(paused.segments, new Date("2026-10-09T15:00:00.000Z"))).toBe(40 * 60_000);
    const stored: VisitClock = { status: "in_progress", startedAt: at, crewSize: 2, applied: ["s"], segments: [{ kind: "job", startedAt: at, endedAt: null }] };
    const clock = projectVisit(visitFromPack(pack, "v1")!, stored, null, [{ clientId: "s", kind: "visit_start", at }]);
    expect(elapsedMs(clock.segments, new Date("2026-10-09T14:05:00.000Z"))).toBe(5 * 60_000);
    const storedPause: VisitClock = { status: "paused", startedAt: "2026-10-09T13:00:00.000Z", crewSize: null, applied: ["p"], segments: [{ kind: "job", startedAt: "2026-10-09T13:00:00.000Z", endedAt: "2026-10-09T13:40:00.000Z" }, { kind: "pause", startedAt: "2026-10-09T13:40:00.000Z", endedAt: null }] };
    const again = projectVisit(running, storedPause, [{ kind: "job", startedAt: "2026-10-09T13:00:00.000Z", endedAt: null }], [{ clientId: "p", kind: "visit_pause", at: "2026-10-09T13:40:00.000Z" }]);
    expect(again.status).toBe("paused");
    expect(elapsedMs(again.segments, new Date("2026-10-09T15:00:00.000Z"))).toBe(40 * 60_000);
  });

  it("names another open stop and patches the pack", () => {
    expect(activeAddress([visitFromPack(pack, "v1")!, visitFromPack(pack, "v2")!], "v1")).toBe("88 Oak");
    const next = patchVisitPack(pack, "v1", { status: "in_progress", started_at: at }) as typeof pack;
    expect(next.visits[0]?.status).toBe("in_progress");
    expect(next.visits[1]?.status).toBe("in_progress");
  });

  it("stores the clock for this lead only", () => {
    const box = { map: new Map<string, string>(), getItem(key: string) { return this.map.get(key) ?? null; }, setItem(key: string, value: string) { this.map.set(key, value); }, removeItem(key: string) { this.map.delete(key); } };
    const clock: VisitClock = { status: "paused", startedAt: at, crewSize: 3, applied: ["a"], segments: [{ kind: "pause", startedAt: at, endedAt: null }] };
    writeClock(box, "user:org", "v1", clock);
    expect(readClock(box, "user:org", "v1")).toEqual(clock);
    expect(readClock(box, "other:org", "v1")).toBeNull();
  });

  it("treats only the live crew lead as able to run the timer", () => {
    const crews = [{ id: "crew-1", default_lead_id: "lead" }, { id: "crew-2", default_lead_id: "other" }];
    const member = { role: "crew_lead", status: "active" };
    expect(isLiveCrewLead({ userId: "lead", crewId: "crew-1", defaultLeadId: "lead", role: "crew_lead", status: "active" })).toBe(true);
    expect(leadFromReads("lead", "crew-1", crews, member)).toBe(true);
    expect(leadFromReads("mate", "crew-1", crews, { role: "crew", status: "active" })).toBe(false);
    expect(leadFromReads("lead", "crew-1", crews, { role: "crew_lead", status: "disabled" })).toBe(false);
    expect(leadFromReads("lead", "crew-2", crews, member)).toBe(false);
    const box = { map: new Map<string, string>(), getItem(key: string) { return this.map.get(key) ?? null; }, setItem(key: string, value: string) { this.map.set(key, value); }, removeItem(key: string) { this.map.delete(key); } };
    rememberLiveLead(box, "a:b", "c", "crew-1", true);
    expect(cachedLiveLead(box, "a", "b:c", "crew-1")).toBeNull();
    expect(cachedLiveLead(box, "a:b", "c", "crew-1")).toBe(true);
    const downloaded = { crew: { id: "crew-1" } };
    expect(saveLeadForPack(box, "lead", "org", downloaded, crews, member)).toBe(true);
    expect(cachedLiveLead(box, "lead", "org", "crew-1")).toBe(true);
    expect(saveLeadForPack(box, "mate", "org", downloaded, crews, { role: "crew", status: "active" })).toBe(false);
    expect(cachedLiveLead(box, "mate", "org", "crew-1")).toBe(false);
    expect(saveLeadForPack(box, "lead", "org", {}, crews, member)).toBeNull();
  });
});
