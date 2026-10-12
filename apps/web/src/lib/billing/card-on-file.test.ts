import { describe, expect, it } from "vitest";
import { cardFromSetupSession, cardOnFileBlockedReason, cardOnFileLabel, cardSetupCheckoutParams, startCardOnFileSetup } from "./card-on-file";

const visaSession = {
  mode: "setup",
  customer: "cus_123",
  metadata: {
    lawnquoter_org_id: "org-1",
    lawnquoter_account_id: "acct-1",
    lawnquoter_purpose: "card_on_file",
  },
  setup_intent: {
    id: "seti_1",
    payment_method: {
      id: "pm_visa",
      type: "card",
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
    },
  },
};

describe("card on file", () => {
  it("labels a saved Visa by brand and last4", () => {
    expect(cardOnFileLabel({ brand: "visa", last4: "4242", kind: "card" })).toBe("Visa ···· 4242");
  });

  it("tells the office to add a Stripe key when payments are off", () => {
    expect(cardOnFileBlockedReason({ stripeKey: false, connectReady: false })).toBe(
      "Not connected - add a Stripe key to enable.",
    );
    expect(cardOnFileBlockedReason({ stripeKey: true, connectReady: true })).toBeNull();
  });

  it("reads the card from a setup Checkout session", () => {
    expect(cardFromSetupSession(visaSession)).toEqual({
      ok: true,
      orgId: "org-1",
      accountId: "acct-1",
      card: {
        stripeCustomerId: "cus_123",
        stripePaymentMethodId: "pm_visa",
        kind: "card",
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
      },
    });
  });

  it("keeps a four-digit last4 and ignores an unknown method", () => {
    const dirty = {
      ...visaSession,
      setup_intent: {
        id: "seti_1",
        payment_method: {
          id: "pm_visa",
          type: "card",
          card: { brand: " Visa ", last4: "xx4242", exp_month: 12, exp_year: 2030 },
        },
      },
    };
    const parsed = cardFromSetupSession(dirty);
    expect(parsed.ok && parsed.card.brand).toBe("visa");
    expect(parsed.ok && parsed.card.last4).toBe("4242");
    expect(
      cardFromSetupSession({
        ...visaSession,
        setup_intent: { id: "seti_1", payment_method: { id: "pm_x", type: "link" } },
      }),
    ).toEqual({ ok: false, reason: "missing_method" });
  });

  it("ignores a payment Checkout session", () => {
    expect(cardFromSetupSession({ ...visaSession, mode: "payment" })).toEqual({ ok: false, reason: "not_setup" });
  });

  it("asks Checkout to save a card or bank account for this account", () => {
    expect(
      cardSetupCheckoutParams({
        accountId: "acct-1",
        orgId: "org-1",
        customerId: "cus_123",
        successUrl: "https://app.example/ok",
        cancelUrl: "https://app.example/cancel",
      }),
    ).toMatchObject({
      mode: "setup",
      customer: "cus_123",
      payment_method_types: ["card", "us_bank_account"],
      payment_method_options: { us_bank_account: { verification_method: "instant" } },
      metadata: { lawnquoter_account_id: "acct-1", lawnquoter_org_id: "org-1", lawnquoter_purpose: "card_on_file" },
    });
  });

  it("does not call Stripe when the key is missing", async () => {
    const result = await startCardOnFileSetup({
      stripeKeyPresent: false,
      connectReady: false,
      stripeAccountId: null,
      customerId: "cus_123",
      accountId: "acct-1",
      orgId: "org-1",
      successUrl: "https://app.example/ok",
      cancelUrl: "https://app.example/cancel",
      createSession: async () => {
        throw new Error("stripe should not be called");
      },
    });
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });
});
