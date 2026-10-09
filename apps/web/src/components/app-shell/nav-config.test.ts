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

  it("leaves Agreements and Schedule where they were", () => {
    expect(item("owner", "Agreements")?.href).toBe("/agreements");
    expect(item("owner", "Schedule")?.href).toBe("/schedule");
    expect(item("sales", "Schedule")).toBeUndefined();
    expect(item("crew", "Schedule")).toBeUndefined();
  });
});
