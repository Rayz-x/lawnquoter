import { describe, expect, it } from "vitest";
import { invoiceForAcceptedQuote, mockImagerySqft, quoteFromMeasurement } from "./lead-flow";

describe("lead to invoice fixture", () => {
  it("prices the mocked 8,000 sq ft lawn at $55 and does not charge", () => {
    const turf = mockImagerySqft();
    expect(turf).toBe(8000);
    expect(quoteFromMeasurement(turf)).toBe(55);
    expect(invoiceForAcceptedQuote(55)).toEqual({ invoiceDollars: 55, charged: false, provider: "mock" });
  });
});
