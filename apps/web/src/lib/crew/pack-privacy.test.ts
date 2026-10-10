import { describe, expect, it } from "vitest";
import { crewPackForbiddenKeys, crewPackIsPrivate } from "./pack-privacy";

const safePack = {
  date: "2026-10-10",
  office: { name: "GreenCo", phone: "217-555-0140" },
  crew: { id: "c1", name: "North" },
  visits: [
    {
      id: "v1",
      budget_minutes: 45,
      title: "Mow",
      property: {
        address_line1: "1503 Larkspur",
        last_name: "Hollis",
        gate_code: "4815",
      },
      tasks: [{ id: "t1", label: "Mow", notes_crew: "edge the walk" }],
    },
  ],
};

describe("crew pack privacy", () => {
  it("accepts a day pack with office phone and no customer money or contact", () => {
    expect(crewPackIsPrivate(safePack)).toBe(true);
    expect(crewPackForbiddenKeys(safePack)).toEqual([]);
  });

  it("rejects prices and customer contact fields anywhere in the pack", () => {
    expect(crewPackForbiddenKeys({ ...safePack, visits: [{ id: "v1", price: 87.65 }] })).toContain("visits.0.price");
    expect(crewPackForbiddenKeys({ visits: [{ property: { phone: "555-0199" } }] })).toContain("visits.0.property.phone");
    expect(crewPackForbiddenKeys({ visits: [{ property: { email: "a@b.com" } }] })).toContain("visits.0.property.email");
    expect(crewPackForbiddenKeys({ visits: [{ property: { billing_email: "b@b.com" } }] })).toContain(
      "visits.0.property.billing_email",
    );
    expect(crewPackIsPrivate({ visits: [{ cost: 10 }] })).toBe(false);
  });
});
