import { describe, expect, it, vi } from "vitest";
import { chargeIssuedVisit, offSessionPaymentIntentParams, shouldAutoCharge } from "./auto-charge";

const visit = {
  id: "11111111-1111-1111-1111-111111111111",
  source: "visit",
  status: "issued",
  totalCents: 4000,
  currency: "USD",
  orgId: "22222222-2222-2222-2222-222222222222",
  accountId: "33333333-3333-3333-3333-333333333333",
};

describe("shouldAutoCharge", () => {
  it("charges a visit invoice that has a default card when the account opted in", () => {
    expect(shouldAutoCharge({ autoCharge: true, hasDefaultMethod: true, source: "visit" })).toBe(true);
  });

  it("stays off for manual invoices, missing cards, and accounts that did not opt in", () => {
    expect(shouldAutoCharge({ autoCharge: false, hasDefaultMethod: true, source: "visit" })).toBe(false);
    expect(shouldAutoCharge({ autoCharge: true, hasDefaultMethod: false, source: "visit" })).toBe(false);
    expect(shouldAutoCharge({ autoCharge: true, hasDefaultMethod: true, source: "manual" })).toBe(false);
  });
});

describe("offSessionPaymentIntentParams", () => {
  it("confirms an off-session charge tagged for the issued invoice", () => {
    expect(
      offSessionPaymentIntentParams({
        amountCents: 4000,
        currency: "USD",
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        invoiceId: visit.id,
        orgId: visit.orgId,
        accountId: visit.accountId,
      }),
    ).toEqual({
      amount: 4000,
      currency: "usd",
      customer: "cus_1",
      payment_method: "pm_1",
      off_session: true,
      confirm: true,
      error_on_requires_action: true,
      metadata: {
        lawnquoter_invoice_id: visit.id,
        lawnquoter_org_id: visit.orgId,
        lawnquoter_account_id: visit.accountId,
        lawnquoter_purpose: "auto_charge",
      },
    });
  });
});

describe("chargeIssuedVisit", () => {
  it("creates the payment intent on the connected account and ignores a decline", async () => {
    const createPaymentIntent = vi.fn().mockResolvedValue({ id: "pi_1" });
    const charged = await chargeIssuedVisit({
      invoice: visit,
      autoCharge: true,
      stripeCustomerId: "cus_1",
      paymentMethodId: "pm_1",
      stripeAccountId: "acct_1",
      chargesEnabled: true,
      stripeKeyPresent: true,
      createPaymentIntent,
    });
    expect(charged).toBe(true);
    expect(createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amount: 4000, off_session: true }), {
      stripeAccount: "acct_1",
      idempotencyKey: `lawnquoter_auto_${visit.id}`,
    });

    createPaymentIntent.mockRejectedValueOnce(new Error("card_declined"));
    const declined = await chargeIssuedVisit({
      invoice: visit,
      autoCharge: true,
      stripeCustomerId: "cus_1",
      paymentMethodId: "pm_1",
      stripeAccountId: "acct_1",
      chargesEnabled: true,
      stripeKeyPresent: true,
      createPaymentIntent,
    });
    expect(declined).toBe(false);
  });

  it("does not call Stripe when the key is missing or the invoice is not a visit", async () => {
    const createPaymentIntent = vi.fn();
    expect(
      await chargeIssuedVisit({
        invoice: visit,
        autoCharge: true,
        stripeCustomerId: "cus_1",
        paymentMethodId: "pm_1",
        stripeAccountId: "acct_1",
        chargesEnabled: true,
        stripeKeyPresent: false,
        createPaymentIntent,
      }),
    ).toBe(false);
    expect(
      await chargeIssuedVisit({
        invoice: { ...visit, source: "progress" },
        autoCharge: true,
        stripeCustomerId: "cus_1",
        paymentMethodId: "pm_1",
        stripeAccountId: "acct_1",
        chargesEnabled: true,
        stripeKeyPresent: true,
        createPaymentIntent,
      }),
    ).toBe(false);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });
});
