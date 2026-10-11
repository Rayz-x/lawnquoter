import { describe, expect, it } from "vitest";
import { achPaymentFailedMessage } from "./ach-payment-failed";

describe("achPaymentFailedMessage", () => {
  it("alerts the office with invoice and Stripe ids only", () => {
    const message = achPaymentFailedMessage({
      to: "office@example.com",
      orgName: "Prairie Mow",
      invoiceNumber: 12,
      amountCents: 12500,
      stripePaymentIntentId: "pi_123",
    });
    expect(message.to).toBe("office@example.com");
    expect(message.subject).toContain("Prairie Mow");
    expect(message.text).toContain("INV-12");
    expect(message.text).toContain("$125.00");
    expect(message.text).toContain("pi_123");
    expect(message.text).not.toMatch(/\d{5,}/); // no full PAN-like strings
  });
});
