import { describe, expect, it } from "vitest";
import {
  CREW_TODAY_SELECTS,
  assembleStops,
  budgetMinutesLabel,
  crewIdsFromMyCrews,
  crewNameLabel,
  crewTodaySelectsAreFieldSafe,
  orgLocalDate,
  propertyAddress,
} from "./today";

describe("crew today selects", () => {
  it("reads address, status, task labels, and budget minutes only", () => {
    expect(crewTodaySelectsAreFieldSafe()).toBe(true);
    expect(CREW_TODAY_SELECTS.property).toBe("id, formatted_address, address_line1");
    expect(CREW_TODAY_SELECTS.visit).not.toMatch(/price|cost|phone|email|gate_code|access_notes/);
    expect(CREW_TODAY_SELECTS.task).toBe("visit_id, label, sort");
    expect(Object.values(CREW_TODAY_SELECTS).join(" ")).not.toMatch(/gate_code|access_notes/);
  });
});

describe("my crews", () => {
  it("keeps crew ids and names for the signed-in user", () => {
    const crews = [
      { crew_id: "c1", name: "North" },
      { crew_id: "c1", name: "North" },
      { crew_id: "c2", name: "  South  " },
      { crew_id: "", name: "Skip" },
    ];
    expect(crewIdsFromMyCrews(crews)).toEqual(["c1", "c2"]);
    expect(crewNameLabel(crews)).toBe("North, South");
  });
});

describe("orgLocalDate", () => {
  it("uses the org timezone, including the previous local evening", () => {
    const instant = new Date("2026-10-09T04:30:00.000Z");
    expect(orgLocalDate("America/Chicago", instant)).toBe("2026-10-08");
    expect(orgLocalDate("UTC", instant)).toBe("2026-10-09");
  });

  it("falls back to UTC when the timezone is invalid", () => {
    const instant = new Date("2026-10-09T04:30:00.000Z");
    expect(orgLocalDate("Not/AZone", instant)).toBe("2026-10-09");
  });
});

describe("assembleStops", () => {
  it("lists address, status, tasks, and minutes without other fields", () => {
    const stops = assembleStops(
      [
        {
          id: "v2",
          status: "in_progress",
          budget_minutes: 45,
          sort: 2,
          property_id: "p2",
        },
        {
          id: "v1",
          status: "scheduled",
          budget_minutes: null,
          sort: 1,
          property_id: "p1",
        },
      ],
      [
        { id: "p1", formatted_address: "1 Oak St, Austin, TX", address_line1: "1 Oak St" },
        { id: "p2", formatted_address: null, address_line1: "9 Pine Rd" },
      ],
      [
        { visit_id: "v1", label: "Mow", sort: 1 },
        { visit_id: "v1", label: "Edge", sort: 0 },
        { visit_id: "v2", label: "Trim", sort: 0 },
      ],
    );

    expect(stops).toEqual([
      {
        id: "v1",
        address: "1 Oak St, Austin, TX",
        statusLabel: "Scheduled",
        budgetLabel: "—",
        tasks: ["Edge", "Mow"],
      },
      {
        id: "v2",
        address: "9 Pine Rd",
        statusLabel: "In progress",
        budgetLabel: "45 min",
        tasks: ["Trim"],
      },
    ]);
    expect(stops.every((stop) => Object.keys(stop).sort().join() === "address,budgetLabel,id,statusLabel,tasks")).toBe(
      true,
    );
    expect(propertyAddress(undefined)).toBe("Address unavailable");
    expect(budgetMinutesLabel(0)).toBe("0 min");
  });
});
