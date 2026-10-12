import { describe, expect, it } from "vitest";
import { irrigationZoneNote } from "./irrigation-zone-note";

describe("irrigation zone note", () => {
  it("keeps the zone number and the note", () => {
    expect(irrigationZoneNote({ zone: 3, note: "  head leaking at the curb  " })).toEqual({
      ok: true,
      note: { zone: 3, note: "head leaking at the curb" },
    });
  });

  it("refuses a blank note", () => {
    expect(irrigationZoneNote({ zone: 3, note: "   " })).toEqual({
      ok: false,
      error: "A zone note is required",
    });
  });
});
