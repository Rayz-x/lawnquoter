import { describe, expect, it } from "vitest";
import { priceLine } from "./price";
import { defaultModifiers, type CatalogRule, type Modifiers } from "./types";

const visit: CatalogRule = {
  type: "catalog",
  materialCost: 0,
  laborCost: 100,
  laborHours: 1,
  materialMarkupPct: 0,
  laborMarkupPct: 0,
};

const zones: Modifiers = {
  ...defaultModifiers(),
  minimum: { price: 45, hours: 0 },
  travelZones: [
    { label: "Nearby", maxMinutes: 15, maxMiles: 8, extraPrice: 0 },
    { label: "Town", maxMinutes: 30, maxMiles: 20, extraPrice: 12 },
    { label: "Farther", maxMinutes: null, maxMiles: null, extraPrice: 35 },
  ],
  routeDensity: { minNearby: 4, discountPct: 0.1, radiusMiles: 0.5 },
  seasonalFactors: [
    { label: "Summer", months: [6, 7, 8], pricePct: 0.1 },
    { label: "Winter", months: [12, 1, 2], pricePct: -0.1 },
  ],
};

const labels = (priced: { breakdown: { label: string }[] }) => priced.breakdown.map((row) => row.label);

describe("travel zones, route density, season, and per-service minimums", () => {
  it("stacks town travel, a dense-route discount, summer, then the higher minimum", () => {
    const priced = priceLine({
      rule: visit,
      quantities: {},
      modifiers: zones,
      context: { driveMinutes: 25, driveMiles: 10, nearbyStops: 5, serviceMonth: 7, serviceMinimum: 125 },
    });
    // 100 + 12 town = 112; 10% off = 100.80; +10% summer = 110.88; floor 125.
    expect(priced.price).toBe(125);
    expect(labels(priced)).toEqual([
      "Material",
      "Labor",
      "Travel (Town)",
      "Route density (5 nearby)",
      "Summer (+10%)",
      "Service minimum",
    ]);
  });

  it("uses whichever drive measure is known and ignores an unknown drive", () => {
    expect(priceLine({ rule: visit, quantities: {}, modifiers: zones, context: { driveMiles: 10 } }).price).toBe(112);
    const unknown = priceLine({ rule: visit, quantities: {}, modifiers: zones, context: {} });
    expect(labels(unknown).some((label) => label.startsWith("Travel"))).toBe(false);
    expect(unknown.price).toBe(100);
  });

  it("keeps the company minimum when the service floor is lower, and raises it when higher", () => {
    expect(priceLine({ rule: { ...visit, laborCost: 20 }, quantities: {}, modifiers: zones, context: { serviceMinimum: 30 } }).price).toBe(45);
    const raised = priceLine({
      rule: { type: "tier_matrix", quantityKey: "each", rows: [{ upTo: null, price: 55, hours: 1, cost: 0 }] },
      quantities: {},
      modifiers: defaultModifiers(),
      context: { serviceMinimum: 80 },
    });
    expect(raised.price).toBe(80);
  });

  it("leaves a normal visit unchanged until the company sets a charge, and discounts winter", () => {
    const plain = priceLine({
      rule: { type: "tier_matrix", quantityKey: "each", rows: [{ upTo: null, price: 55, hours: 1, cost: 0 }] },
      quantities: {},
      modifiers: defaultModifiers(),
      context: { driveMinutes: 40, nearbyStops: 8, serviceMonth: 7 },
    });
    expect(plain.price).toBe(55);
    const winter = priceLine({
      rule: visit,
      quantities: {},
      modifiers: { ...zones, minimum: { price: 0, hours: 0 } },
      context: { serviceMonth: 1, nearbyStops: 2 },
    });
    expect(winter.price).toBe(90);
    expect(labels(winter)).toContain("Winter (−10%)");
  });
});
