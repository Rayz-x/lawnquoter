import { describe, expect, it } from "vitest";
import { costVisit, groupCosting, type CostingInput } from "./job-costing";

const mow: CostingInput = {
  service: "Mow",
  crew: "North",
  customer: "Ada",
  estimatedHours: 2,
  estimatedCostCents: 4000,
  actualMinutes: 90,
  crewSize: 2,
  revenueCents: 8000,
  hourlyRate: 20,
  burdenPct: 0,
};

describe("job costing", () => {
  it("compares estimated hours and cost with actual man-hours, labor, and margin", () => {
    const row = costVisit(mow);
    expect(row.actualHours).toBe(1.5);
    expect(row.manHours).toBe(3);
    expect(row.actualCostCents).toBe(6000);
    expect(row.marginCents).toBe(2000);
    expect(row.dollarsPerManHour).toBeCloseTo(80 / 3);
  });

  it("rolls visits up by service, crew, and customer", () => {
    const second: CostingInput = { ...mow, customer: "Bea", actualMinutes: 60, crewSize: 1, revenueCents: 4000 };
    expect(groupCosting([mow, second], (row) => row.service)).toHaveLength(1);
    expect(groupCosting([mow, second], (row) => row.crew)[0]?.manHours).toBe(4);
    expect(groupCosting([mow, second], (row) => row.customer).map((row) => row.label)).toEqual(["Ada", "Bea"]);
  });
});
