import { describe, expect, it } from "vitest";
import { depositCents, depositCheckoutParams } from "./deposit";

describe("deposit at acceptance", () => {
  it("turns a 25 dollar deposit into 2500 cents", () => {
    expect(depositCents(25)).toBe(2500);
    expect(depositCents("20.5")).toBe(2050);
    expect(depositCents(0)).toBe(0);
    expect(depositCents(null)).toBe(0);
  });

  it("saves the card for later charges while collecting the deposit", () => {
    const params = depositCheckoutParams({
      invoice: {
        id: "inv-1",
        orgId: "org-1",
        accountId: "acct-1",
        number: 4,
        numberLabel: "INV-2026-0004",
        status: "issued",
        currency: "usd",
        totalCents: 2500,
        publicToken: "tok-1",
      },
      successUrl: "https://app.example/q/tok?paid=1",
      cancelUrl: "https://app.example/q/tok",
    });
    expect(params.payment_intent_data.setup_future_usage).toBe("off_session");
    expect(params.line_items[0]?.price_data.unit_amount).toBe(2500);
    expect(params.metadata.lawnquoter_purpose).toBe("deposit");
    expect(params.payment_method_options.us_bank_account.verification_method).toBe("instant");
  });
});
