import { FIELD_ROLES, ORG_ROLES } from "@lawnquoter/shared";
import { describe, expect, it } from "vitest";
import { visibleNav } from "./nav-config";

function item(role: (typeof ORG_ROLES)[number], title: string) {
  return visibleNav(role)
    .flatMap((group) => group.items)
    .find((navItem) => navItem.title === title);
}

describe("Crew App nav", () => {
  it("points field roles at today's route and hides it from sales and read_only", () => {
    for (const role of ORG_ROLES) {
      const crew = item(role, "Crew App");
      if ((FIELD_ROLES as readonly string[]).includes(role)) {
        expect(crew?.href).toBe("/crew/today");
      } else {
        expect(crew).toBeUndefined();
      }
    }
  });

  it("shows Leads to office roles and read_only, and hides it from crew", () => {
    for (const role of ["owner", "admin", "sales", "dispatcher", "read_only"] as const) {
      expect(item(role, "Leads")?.href).toBe("/leads");
    }
    expect(item("crew", "Leads")).toBeUndefined();
    expect(item("crew_lead", "Leads")).toBeUndefined();
  });

  it("keeps Agreements, Schedule, Invoices, Lead sources, and Crews as office items", () => {
    expect(item("owner", "Agreements")?.href).toBe("/agreements");
    expect(item("sales", "Agreements")?.href).toBe("/agreements");
    expect(item("read_only", "Agreements")?.href).toBe("/agreements");
    expect(item("crew", "Agreements")).toBeUndefined();
    expect(item("crew_lead", "Agreements")).toBeUndefined();

    expect(item("owner", "Invoices")?.href).toBe("/invoices");
    expect(item("sales", "Invoices")?.href).toBe("/invoices");
    expect(item("dispatcher", "Invoices")?.href).toBe("/invoices");
    expect(item("read_only", "Invoices")?.href).toBe("/invoices");
    expect(item("crew", "Invoices")).toBeUndefined();
    expect(item("crew_lead", "Invoices")).toBeUndefined();

    expect(item("owner", "Schedule")?.href).toBe("/schedule");
    expect(item("sales", "Schedule")?.href).toBe("/schedule");
    expect(item("read_only", "Schedule")?.href).toBe("/schedule");
    expect(item("dispatcher", "Schedule")?.href).toBe("/schedule");
    expect(item("crew", "Schedule")).toBeUndefined();
    expect(item("crew_lead", "Schedule")).toBeUndefined();

    expect(item("owner", "Lead sources")?.href).toBe("/leads/report");
    expect(item("sales", "Lead sources")?.href).toBe("/leads/report");
    expect(item("read_only", "Lead sources")?.href).toBe("/leads/report");
    expect(item("dispatcher", "Lead sources")?.href).toBe("/leads/report");
    expect(item("crew", "Lead sources")).toBeUndefined();
    expect(item("crew_lead", "Lead sources")).toBeUndefined();

    expect(item("owner", "Billing review")?.href).toBe("/billing/review");
    expect(item("dispatcher", "Billing review")?.href).toBe("/billing/review");
    expect(item("read_only", "Billing review")?.href).toBe("/billing/review");
    expect(item("crew", "Billing review")).toBeUndefined();
    expect(item("crew_lead", "Billing review")).toBeUndefined();

    expect(item("dispatcher", "Crews")?.href).toBe("/settings/crews");
    expect(item("owner", "Crews")?.href).toBe("/settings/crews");
    expect(item("sales", "Crews")).toBeUndefined();
    expect(item("read_only", "Crews")).toBeUndefined();
  });
});
