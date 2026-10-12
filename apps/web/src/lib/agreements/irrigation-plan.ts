import { priceIrrigation } from "@lawnquoter/pricing-engine";

/** Zone-count price and the visit length that price implies. */
export function irrigationVisit(zones: number, pricePerZone: number, minutesPerZone: number): { price: number; minutes: number } {
  const priced = priceIrrigation(
    { type: "irrigation", pricePerZone, minutesPerZone, costPerZone: 0 },
    { zones },
  );
  return { price: priced.price, minutes: zones * minutesPerZone };
}
