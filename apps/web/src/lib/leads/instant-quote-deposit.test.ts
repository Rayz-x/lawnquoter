import { describe, expect, it, vi } from "vitest";
import { depositAmountCents, startDepositCheckout } from "./instant-quote-deposit";

describe("depositAmountCents", () => {
  it("uses the company setting when it is set, otherwise the low end of the range", () => {
    expect(depositAmountCents(2500, 50)).toBe(2500);
    expect(depositAmountCents(null, 64.9)).toBe(6490);
    expect(depositAmountCents(0, 50)).toBe(5000);
  });
});

describe("startDepositCheckout", () => {
  it("does not call Stripe when the Connect account is missing", async () => {
    const sessionsCreate = vi.fn();
    const result = await startDepositCheckout({
      stripeAccountId: null,
      amountCents: 5000,
      leadId: "lead-1",
      orgId: "org-1",
      successUrl: "https://app.example/w/acme?deposit=paid",
      cancelUrl: "https://app.example/w/acme",
      stripe: { checkout: { sessions: { create: sessionsCreate } } },
    });
    expect(result).toEqual({ ok: false, reason: "not_connected" });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("opens Checkout on the connected account for the deposit", async () => {
    const sessionsCreate = vi.fn().mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    const result = await startDepositCheckout({
      stripeAccountId: "acct_connected",
      amountCents: 5000,
      leadId: "lead-1",
      orgId: "org-1",
      successUrl: "https://app.example/w/acme?deposit=paid",
      cancelUrl: "https://app.example/w/acme",
      stripe: { checkout: { sessions: { create: sessionsCreate } } },
    });
    expect(result).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      sessionId: "cs_test_1",
    });
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({ currency: "usd", unit_amount: 5000 }),
          }),
        ],
        client_reference_id: "lead-1",
        metadata: expect.objectContaining({
          lawnquoter_lead_id: "lead-1",
          lawnquoter_org_id: "org-1",
        }),
      }),
      { stripeAccount: "acct_connected", idempotencyKey: "lawnquoter_instant_quote_deposit_lead-1" },
    );
  });
});
