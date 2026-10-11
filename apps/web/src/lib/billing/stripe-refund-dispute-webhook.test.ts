import { describe, expect, it } from "vitest";
import {
  applyStripeRefundDisputeEvent,
  type RefundDisputeStore,
  type StripeRefundDisputeEvent,
} from "./stripe-refund-dispute-webhook";

function store(overrides: Partial<RefundDisputeStore> = {}): RefundDisputeStore & {
  calls: {
    claim: string[];
    refund: unknown[];
    flag: unknown[];
    clear: unknown[];
  };
} {
  const calls = {
    claim: [] as string[],
    refund: [] as unknown[],
    flag: [] as unknown[],
    clear: [] as unknown[],
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
    async findPaymentByChargeId(chargeId) {
      if (chargeId !== "ch_1") return null;
      return {
        id: "pay-1",
        orgId: "org-1",
        accountId: "acct-1",
        invoiceId: "inv-1",
        status: "succeeded",
        stripeChargeId: "ch_1",
        stripePaymentIntentId: "pi_1",
        stripeRefundId: null,
      };
    },
    async findPaymentByPaymentIntentId(paymentIntentId) {
      if (paymentIntentId !== "pi_1") return null;
      return {
        id: "pay-1",
        orgId: "org-1",
        accountId: "acct-1",
        invoiceId: "inv-1",
        status: "succeeded",
        stripeChargeId: "ch_1",
        stripePaymentIntentId: "pi_1",
        stripeRefundId: null,
      };
    },
    async markPaymentRefunded(input) {
      calls.refund.push(input);
      return { recorded: true };
    },
    async flagDispute(input) {
      calls.flag.push(input);
    },
    async clearDispute(input) {
      calls.clear.push(input);
    },
    ...overrides,
  };
}

function chargeRefunded(
  overrides: Partial<StripeRefundDisputeEvent["object"]> = {},
): StripeRefundDisputeEvent {
  return {
    id: "evt_refund_1",
    type: "charge.refunded",
    object: {
      id: "ch_1",
      object: "charge",
      payment_intent: "pi_1",
      amount_refunded: 12500,
      refunds: {
        data: [{ id: "re_1", amount: 12500 }],
      },
      ...overrides,
    },
  };
}

function disputeCreated(
  overrides: Partial<StripeRefundDisputeEvent["object"]> = {},
): StripeRefundDisputeEvent {
  return {
    id: "evt_dispute_1",
    type: "charge.dispute.created",
    object: {
      id: "dp_1",
      object: "dispute",
      charge: "ch_1",
      payment_intent: "pi_1",
      status: "needs_response",
      evidence_details: { due_by: 1_760_000_000 },
      ...overrides,
    },
  };
}

function disputeClosed(
  overrides: Partial<StripeRefundDisputeEvent["object"]> = {},
): StripeRefundDisputeEvent {
  return {
    id: "evt_dispute_closed_1",
    type: "charge.dispute.closed",
    object: {
      id: "dp_1",
      object: "dispute",
      charge: "ch_1",
      payment_intent: "pi_1",
      status: "won",
      evidence_details: { due_by: 1_760_000_000 },
      ...overrides,
    },
  };
}

describe("applyStripeRefundDisputeEvent", () => {
  it("records a refund once on charge.refunded", async () => {
    const s = store();
    const result = await applyStripeRefundDisputeEvent({ event: chargeRefunded(), store: s });
    expect(result).toEqual({ ok: true, outcome: "refunded" });
    expect(s.calls.refund).toEqual([
      expect.objectContaining({
        paymentId: "pay-1",
        stripeRefundId: "re_1",
        amountCents: 12500,
      }),
    ]);
  });

  it("is a no-op when the Stripe event id was already processed", async () => {
    const s = store({
      async claimEvent() {
        return { claimed: false };
      },
    });
    const result = await applyStripeRefundDisputeEvent({ event: chargeRefunded(), store: s });
    expect(result).toEqual({ ok: true, outcome: "duplicate" });
    expect(s.calls.refund).toHaveLength(0);
  });

  it("does not double-write when the payment is already refunded", async () => {
    const s = store({
      async findPaymentByChargeId() {
        return {
          id: "pay-1",
          orgId: "org-1",
          accountId: "acct-1",
          invoiceId: "inv-1",
          status: "refunded",
          stripeChargeId: "ch_1",
          stripePaymentIntentId: "pi_1",
          stripeRefundId: "re_1",
        };
      },
      async markPaymentRefunded(input) {
        s.calls.refund.push(input);
        return { recorded: false };
      },
    });
    const result = await applyStripeRefundDisputeEvent({ event: chargeRefunded(), store: s });
    expect(result).toEqual({ ok: true, outcome: "refunded" });
    expect(s.calls.refund).toHaveLength(1);
  });

  it("flags invoice and account with deadline on charge.dispute.created", async () => {
    const s = store();
    const result = await applyStripeRefundDisputeEvent({ event: disputeCreated(), store: s });
    expect(result).toEqual({ ok: true, outcome: "dispute_flagged" });
    expect(s.calls.flag).toEqual([
      expect.objectContaining({
        invoiceId: "inv-1",
        accountId: "acct-1",
        orgId: "org-1",
        stripeDisputeId: "dp_1",
        deadline: new Date(1_760_000_000 * 1000).toISOString(),
      }),
    ]);
  });

  it("clears the dispute flag on charge.dispute.closed", async () => {
    const s = store();
    const result = await applyStripeRefundDisputeEvent({ event: disputeClosed(), store: s });
    expect(result).toEqual({ ok: true, outcome: "dispute_cleared" });
    expect(s.calls.clear).toEqual([
      expect.objectContaining({
        invoiceId: "inv-1",
        accountId: "acct-1",
        stripeDisputeId: "dp_1",
      }),
    ]);
  });
});
