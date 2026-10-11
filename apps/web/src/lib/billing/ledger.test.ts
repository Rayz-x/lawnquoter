import { describe, expect, it } from "vitest";
import {
  accountCreditToApplyCents,
  invoiceBalanceCents,
  isOfficePaymentMethod,
} from "./ledger";

describe("invoiceBalanceCents", () => {
  it("reduces balance by payments and credit notes without going negative", () => {
    expect(
      invoiceBalanceCents({ totalCents: 10000, paymentCents: 2500, creditNoteCents: 4000 }),
    ).toBe(3500);
    expect(
      invoiceBalanceCents({ totalCents: 10000, paymentCents: 6000, creditNoteCents: 6000 }),
    ).toBe(0);
  });
});

describe("accountCreditToApplyCents", () => {
  it("applies only up to the amount due on the next draft", () => {
    expect(accountCreditToApplyCents(5000, 12000)).toBe(5000);
    expect(accountCreditToApplyCents(9000, 4000)).toBe(4000);
    expect(accountCreditToApplyCents(0, 4000)).toBe(0);
  });
});

describe("isOfficePaymentMethod", () => {
  it("accepts cash and check only", () => {
    expect(isOfficePaymentMethod("cash")).toBe(true);
    expect(isOfficePaymentMethod("check")).toBe(true);
    expect(isOfficePaymentMethod("stripe")).toBe(false);
    expect(isOfficePaymentMethod("account_credit")).toBe(false);
  });
});
