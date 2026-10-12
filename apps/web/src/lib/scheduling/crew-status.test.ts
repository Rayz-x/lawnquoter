import { describe, expect, it } from "vitest";
import { applyCrewPresence, crewStatusLabel, presenceFromChange } from "./crew-status";

describe("crew status", () => {
  it("replaces one crew and keeps the other", () => {
    const start = [{ crewId: "crew-a", state: "on_site" as const, visitId: "visit-1" }];
    expect(applyCrewPresence(start, { crewId: "crew-a", state: "break", visitId: "visit-1" })).toEqual([
      { crewId: "crew-a", state: "break", visitId: "visit-1" },
    ]);
    expect(applyCrewPresence(start, { crewId: "crew-b", state: "en_route", visitId: null })).toEqual([
      { crewId: "crew-a", state: "on_site", visitId: "visit-1" },
      { crewId: "crew-b", state: "en_route", visitId: null },
    ]);
  });

  it("reads a realtime row and ignores an unknown state", () => {
    expect(presenceFromChange({ crew_id: "crew-a", state: "done", visit_id: null })).toEqual({
      crewId: "crew-a",
      state: "done",
      visitId: null,
    });
    expect(presenceFromChange({ crew_id: "crew-a", state: "flying" })).toBeNull();
    expect(crewStatusLabel("on_site")).toBe("On site");
  });
});
