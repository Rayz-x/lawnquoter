import { describe, expect, it } from "vitest";
import {
  applyDefaultAssignee,
  buildContactActivity,
  buildFollowUpActivity,
  buildReassignActivity,
  canEditLeads,
  canViewLeads,
  defaultAssigneeId,
  nextFirstContactedAt,
  type LeadSettings,
} from "./detail";

describe("first_contacted_at", () => {
  it("sets first_contacted_at on the first logged contact only", () => {
    const first = "2026-10-10T15:00:00.000Z";
    const second = "2026-10-10T16:00:00.000Z";
    expect(nextFirstContactedAt(null, first)).toBe(first);
    expect(nextFirstContactedAt(first, second)).toBe(first);
  });
});

describe("default assignee", () => {
  it("assigns a new lead to the org default assignee, falling back to the owner", () => {
    const settings: LeadSettings = { default_assignee_id: "sales-1" };
    expect(defaultAssigneeId(settings, "owner-1")).toBe("sales-1");
    expect(defaultAssigneeId({ default_assignee_id: null }, "owner-1")).toBe("owner-1");
    expect(applyDefaultAssignee({ assigned_to: null }, "owner-1")).toEqual({ assigned_to: "owner-1" });
    expect(applyDefaultAssignee({ assigned_to: "sales-1" }, "owner-1")).toBeNull();
  });
});

describe("activity builders", () => {
  it("writes an activity payload for contact, reassign, and follow-up", () => {
    expect(buildContactActivity("call")).toMatchObject({
      kind: "lead.contact.call",
      summary: "Logged call",
    });
    expect(buildReassignActivity("Ada", "Ben")).toMatchObject({
      kind: "lead.reassigned",
      summary: "Reassigned from Ada to Ben",
    });
    expect(buildFollowUpActivity("2026-10-12")).toMatchObject({
      kind: "lead.follow_up_set",
      summary: "Next follow-up set to 2026-10-12",
      meta: { next_follow_up_on: "2026-10-12" },
    });
  });
});

describe("lead detail permissions", () => {
  it("lets office roles view; read_only cannot edit; crew cannot view", () => {
    expect(canViewLeads("read_only")).toBe(true);
    expect(canEditLeads("read_only")).toBe(false);
    expect(canEditLeads("sales")).toBe(true);
    expect(canViewLeads("crew")).toBe(false);
    expect(canEditLeads("crew")).toBe(false);
  });
});
