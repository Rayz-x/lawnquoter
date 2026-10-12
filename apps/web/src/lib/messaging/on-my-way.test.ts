import { describe, expect, it } from "vitest";
import { crewMayTextOnMyWay, onMyWayText } from "./on-my-way";
import { TWILIO_NOT_CONNECTED } from "./sms";

const ready = {
  templateBody: null,
  company: "North Lawn",
  address: "100 Maple St",
  phone: "(555) 111-0000",
  optedIn: true,
  inbound: false,
  connected: true,
  status: "scheduled",
};

describe("on my way texts", () => {
  it("stays off until Twilio is connected", () => {
    expect(onMyWayText({ ...ready, connected: false })).toEqual({ ok: false, error: TWILIO_NOT_CONNECTED });
  });

  it("uses the suggested wording for a scheduled stop", () => {
    expect(onMyWayText(ready)).toEqual({
      ok: true,
      to: "+15551110000",
      body: "North Lawn is on the way to 100 Maple St.",
    });
  });

  it("refuses a finished stop and a person who has not agreed", () => {
    expect(onMyWayText({ ...ready, status: "completed" })).toEqual({
      ok: false,
      error: "On my way is only for a stop that has not finished.",
    });
    expect(onMyWayText({ ...ready, optedIn: false, inbound: false })).toEqual({
      ok: false,
      error: "This person has not agreed to texts.",
    });
  });

  it("lets the live crew lead text and refuses another crew member", () => {
    const lead = { office: false, role: "crew_lead", userId: "lead", active: true, crewKnown: true, openLeadId: "lead", defaultLeadId: "other" };
    expect(crewMayTextOnMyWay(lead)).toBe(true);
    expect(crewMayTextOnMyWay({ ...lead, openLeadId: null, defaultLeadId: "lead" })).toBe(true);
    expect(crewMayTextOnMyWay({ ...lead, userId: "mate", role: "crew" })).toBe(false);
    expect(crewMayTextOnMyWay({ ...lead, openLeadId: "other" })).toBe(false);
    expect(crewMayTextOnMyWay({ ...lead, crewKnown: false })).toBe(false);
    expect(crewMayTextOnMyWay({ ...lead, active: false })).toBe(false);
    expect(crewMayTextOnMyWay({ ...lead, office: true, role: "crew", userId: "mate", crewKnown: false })).toBe(true);
  });
});
