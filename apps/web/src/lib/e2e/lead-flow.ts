import { priceLine, defaultModifiers, type TierMatrixRule } from "@lawnquoter/pricing-engine";

const WEEKLY_MOW: TierMatrixRule = {
  type: "tier_matrix",
  quantityKey: "turf_sqft",
  rows: [
    { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
    { upTo: 10000, price: 55, hours: 0.75, cost: 24 },
    { upTo: null, price: 70, hours: 1, cost: 32 },
  ],
  tail: { every: 1000, over: 15000, addPrice: 5, addHours: 0.08, addCost: 2 },
};

/** Canned imagery. Nearmap, Vexcel, and Esri are not called. */
export function mockImagerySqft(): number {
  return 8000;
}

export function quoteFromMeasurement(turfSqft: number): number {
  const modifiers = { ...defaultModifiers(), minimum: { price: 0, hours: 0 } };
  return priceLine({ rule: WEEKLY_MOW, quantities: { turf_sqft: turfSqft }, modifiers, context: {} }).price;
}

/** A recorded invoice. Stripe is not called, so nothing is charged. */
export function invoiceForAcceptedQuote(quoteDollars: number): { invoiceDollars: number; charged: false; provider: "mock" } {
  return { invoiceDollars: quoteDollars, charged: false, provider: "mock" };
}
