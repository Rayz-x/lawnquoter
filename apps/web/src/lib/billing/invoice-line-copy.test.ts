import { describe, expect, it } from "vitest";
import { invoiceLineCustomerCopy } from "./invoice-line-copy";

describe("invoiceLineCustomerCopy", () => {
  it("renders estimate and billed amounts for a ranged line", () => {
    expect(
      invoiceLineCustomerCopy({
        description: "Weekly mow",
        amountCents: 36500,
        estimateLowCents: 30000,
        estimateHighCents: 42000,
      }),
    ).toBe("Estimated $300-$420 · Billed $365");
  });

  it("falls back to the description when no range is set", () => {
    expect(
      invoiceLineCustomerCopy({
        description: "Spring cleanup",
        amountCents: 15000,
        estimateLowCents: null,
        estimateHighCents: null,
      }),
    ).toBe("Spring cleanup");
  });
});
