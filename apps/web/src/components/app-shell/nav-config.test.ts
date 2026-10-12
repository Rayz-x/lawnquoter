import { FIELD_ROLES, ORG_ROLES } from "@lawnquoter/shared";
import { describe, expect, it } from "vitest";
import { categoryFor, visibleNav } from "./nav-config";

function item(role: (typeof ORG_ROLES)[number], title: string) {
  return visibleNav(role)
    .flatMap((group) => group.items)
    .find((navItem) => navItem.title === title);
}

describe("office nav categories", () => {
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

  it("shows Requests to office roles and read_only, and hides it from crew", () => {
    for (const role of ["owner", "admin", "sales", "dispatcher", "read_only"] as const) {
      expect(item(role, "Requests")?.href).toBe("/leads");
    }
    expect(item("crew", "Requests")).toBeUndefined();
    expect(item("crew_lead", "Requests")).toBeUndefined();
  });

  it("keeps Agreements, Schedule, Invoices, Reports, and Crews as office items", () => {
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

    expect(item("owner", "Reports")?.href).toBe("/leads/report");
    expect(item("sales", "Reports")?.href).toBe("/leads/report");
    expect(item("read_only", "Reports")?.href).toBe("/leads/report");
    expect(item("dispatcher", "Reports")?.href).toBe("/leads/report");
    expect(item("crew", "Reports")).toBeUndefined();
    expect(item("crew_lead", "Reports")).toBeUndefined();

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

  it("groups the bar the way field-service apps do, and parks settings on the user menu", () => {
    const owner = visibleNav("owner");
    expect(owner.filter((category) => category.place === "bar").map((category) => category.label)).toEqual([
      "Home",
      "Schedule",
      "Clients",
      "Sales",
      "Work",
      "Money",
      "Reports",
    ]);
    expect(owner.find((category) => category.label === "Clients")?.items.map((entry) => entry.title)).toEqual([
      "Accounts",
      "Properties",
      "Import customers",
      "Requests",
      "Texts",
      "Calls",
    ]);
    expect(item("owner", "Import customers")?.href).toBe("/accounts/import");
    expect(item("admin", "Import customers")).toBeUndefined();
    expect(item("sales", "Import customers")).toBeUndefined();
    expect(owner.find((category) => category.label === "Sales")?.items.map((entry) => entry.href)).toEqual([
      "/quotes",
      "/bids",
      "/tasks",
      "/settings/pricing",
    ]);
    expect(owner.find((category) => category.label === "Money")?.items.map((entry) => entry.title)).toEqual([
      "Invoices",
      "Payments",
      "Billing review",
    ]);
    expect(owner.find((category) => category.label === "Settings")?.place).toBe("user");
    expect(item("sales", "Price book")).toBeUndefined();
    expect(item("owner", "Price book")?.href).toBe("/settings/pricing");
    expect(item("dispatcher", "Quotes")).toBeUndefined();
    expect(item("sales", "Team")).toBeUndefined();
    expect(item("owner", "Settings")?.href).toBe("/settings");
  });

  it("highlights the category that owns the child route", () => {
    const owner = visibleNav("owner");
    expect(categoryFor("/dashboard", owner)?.label).toBe("Home");
    expect(categoryFor("/leads/report", owner)?.label).toBe("Reports");
    expect(categoryFor("/leads/abc", owner)?.label).toBe("Clients");
    expect(categoryFor("/settings/pricing", owner)?.label).toBe("Sales");
    expect(categoryFor("/settings/crews", owner)?.label).toBe("Work");
    expect(categoryFor("/settings/team", owner)?.label).toBe("Settings");
    expect(categoryFor("/settings/profile", owner)?.label).toBe("Settings");
    expect(categoryFor("/invoices/1", owner)?.label).toBe("Money");
    expect(categoryFor("/properties/1", owner)?.label).toBe("Clients");
    expect(categoryFor("/quotes/new", owner)?.label).toBe("Sales");
  });
});

describe("office route reachability", () => {
  it("every top-level office page is in the owner's nav, including the price book catalog", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname, "../../app/(app)");
    const pages: string[] = [];
    const walk = (dir: string, route: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (!name.startsWith("[") && !name.startsWith("(")) walk(full, `${route}/${name}`);
        } else if (name === "page.tsx" && route && !route.endsWith("/new")) pages.push(route);
      }
    };
    walk(root, "");
    const hrefs = new Set(visibleNav("owner").flatMap((category) => category.items.map((navItem) => navItem.href)));
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.filter((page) => !hrefs.has(page))).toEqual([]);
  });
});
