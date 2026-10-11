import { describe, expect, it, vi } from "vitest";
import {
  applyStripePaymentEvent,
  type PaymentWebhookStore,
  type StripePaymentEvent,
} from "./stripe-payment-webhook";

function store(overrides: Partial<PaymentWebhookStore> = {}): PaymentWebhookStore & {
  calls: {
    claim: string[];
    upsert: unknown[];
    markPaid: string[];
    reopen: string[];
    alert: unknown[];
  };
} {
  const calls = {
    claim: [] as string[],
    upsert: [] as unknown[],
    markPaid: [] as string[],
    reopen: [] as string[],
    alert: [] as unknown[],
  };
  return {
    calls,
    async claimEvent(eventId, eventType, orgId, payload) {
      calls.claim.push(eventId);
      void eventType;
      void orgId;
      void payload;
      return { claimed: true };
    },
    async findInvoiceById(invoiceId) {
      return {
        id: invoiceId,
        orgId: "org-1",
        accountId: "acct-1",
        status: "issued",
        totalCents: 12500,
        currency: "usd",
        number: 42,
      };
    },
    async upsertPayment(row) {
      calls.upsert.push(row);
      return { id: "pay-1" };
    },
    async markInvoicePaid(invoiceId) {
      calls.markPaid.push(invoiceId);
    },
    async reopenInvoice(invoiceId) {
      calls.reopen.push(invoiceId);
    },
    async alertOfficeAchFailed(input) {
      calls.alert.push(input);
    },
    ...overrides,
  };
}

function sessionCompleted(overrides: Partial<StripePaymentEvent["object"]> = {}): StripePaymentEvent {
  return {
    id: "evt_session_1",
    type: "checkout.session.completed",
    object: {
      id: "cs_1",
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 12500,
      currency: "usd",
      payment_intent: "pi_card_1",
      metadata: {
        lawnquoter_invoice_id: "inv-1",
        lawnquoter_org_id: "org-1",
        lawnquoter_account_id: "acct-1",
      },
      ...overrides,
    },
  };
}

function paymentIntent(
  type: StripePaymentEvent["type"],
  overrides: Partial<StripePaymentEvent["object"]> = {},
): StripePaymentEvent {
  return {
    id: `evt_${type}`,
    type,
    object: {
      id: "pi_ach_1",
      object: "payment_intent",
      status: type === "payment_intent.succeeded" ? "succeeded" : type === "payment_intent.processing" ? "processing" : "requires_payment_method",
      amount: 12500,
      currency: "usd",
      latest_charge: "ch_1",
      metadata: {
        lawnquoter_invoice_id: "inv-1",
        lawnquoter_org_id: "org-1",
        lawnquoter_account_id: "acct-1",
      },
      payment_method_types: ["us_bank_account"],
      ...overrides,
    },
  };
}

describe("applyStripePaymentEvent", () => {
  it("is a no-op when the Stripe event id was already processed", async () => {
    const s = store({
      async claimEvent() {
        return { claimed: false };
      },
    });
    const result = await applyStripePaymentEvent({
      event: sessionCompleted(),
      store: s,
      paymentMethodDetails: async () => null,
    });
    expect(result).toEqual({ ok: true, outcome: "duplicate" });
    expect(s.calls.upsert).toHaveLength(0);
    expect(s.calls.markPaid).toHaveLength(0);
  });

  it("marks the invoice paid on card checkout.session.completed", async () => {
    const s = store();
    const result = await applyStripePaymentEvent({
      event: sessionCompleted(),
      store: s,
      paymentMethodDetails: async () => ({ brand: "visa", last4: "4242", type: "card" }),
    });
    expect(result).toEqual({ ok: true, outcome: "paid" });
    expect(s.calls.upsert).toEqual([
      expect.objectContaining({
        orgId: "org-1",
        accountId: "acct-1",
        invoiceId: "inv-1",
        amountCents: 12500,
        currency: "usd",
        status: "succeeded",
        stripePaymentIntentId: "pi_card_1",
        stripeCheckoutSessionId: "cs_1",
        cardBrand: "visa",
        cardLast4: "4242",
      }),
    ]);
    expect(s.calls.markPaid).toEqual(["inv-1"]);
  });

  it("records ACH processing without marking the invoice paid", async () => {
    const s = store();
    const result = await applyStripePaymentEvent({
      event: paymentIntent("payment_intent.processing"),
      store: s,
      paymentMethodDetails: async () => ({ brand: null, last4: "6789", type: "us_bank_account" }),
    });
    expect(result).toEqual({ ok: true, outcome: "processing" });
    expect(s.calls.upsert).toEqual([
      expect.objectContaining({
        status: "processing",
        stripePaymentIntentId: "pi_ach_1",
        cardLast4: "6789",
      }),
    ]);
    expect(s.calls.markPaid).toHaveLength(0);
  });

  it("marks paid when ACH payment_intent.succeeded", async () => {
    const s = store();
    const result = await applyStripePaymentEvent({
      event: paymentIntent("payment_intent.succeeded"),
      store: s,
      paymentMethodDetails: async () => ({ brand: null, last4: "6789", type: "us_bank_account" }),
    });
    expect(result).toEqual({ ok: true, outcome: "paid" });
    expect(s.calls.upsert[0]).toEqual(expect.objectContaining({ status: "succeeded" }));
    expect(s.calls.markPaid).toEqual(["inv-1"]);
  });

  it("reopens the invoice and alerts the office when ACH fails", async () => {
    const s = store({
      async findInvoiceById() {
        return {
          id: "inv-1",
          orgId: "org-1",
          accountId: "acct-1",
          status: "paid",
          totalCents: 12500,
          currency: "usd",
          number: 42,
        };
      },
    });
    const result = await applyStripePaymentEvent({
      event: paymentIntent("payment_intent.payment_failed"),
      store: s,
      paymentMethodDetails: async () => ({ brand: null, last4: "6789", type: "us_bank_account" }),
    });
    expect(result).toEqual({ ok: true, outcome: "failed_reopened" });
    expect(s.calls.upsert[0]).toEqual(expect.objectContaining({ status: "failed" }));
    expect(s.calls.reopen).toEqual(["inv-1"]);
    expect(s.calls.alert).toEqual([
      expect.objectContaining({
        orgId: "org-1",
        invoiceId: "inv-1",
        invoiceNumber: 42,
        amountCents: 12500,
        stripePaymentIntentId: "pi_ach_1",
      }),
    ]);
    expect(s.calls.markPaid).toHaveLength(0);
  });

  it("ignores events that are not payment writers", async () => {
    const s = store();
    const result = await applyStripePaymentEvent({
      event: {
        id: "evt_other",
        type: "account.updated",
        object: { id: "acct_1", object: "account" },
      },
      store: s,
      paymentMethodDetails: async () => null,
    });
    expect(result).toEqual({ ok: true, outcome: "ignored" });
    expect(s.calls.claim).toHaveLength(0);
  });
});
