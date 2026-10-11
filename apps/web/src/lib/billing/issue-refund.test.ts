import { describe, expect, it, vi } from "vitest";
import { issueStripeRefund, type IssueRefundStore } from "./issue-refund";

function store(overrides: Partial<IssueRefundStore> = {}): IssueRefundStore {
  return {
    async loadPayment(paymentId) {
      if (paymentId !== "pay-1") return null;
      return {
        id: "pay-1",
        orgId: "org-1",
        status: "succeeded",
        amountCents: 12500,
        stripeChargeId: "ch_1",
        stripePaymentIntentId: "pi_1",
      };
    },
    async loadConnectAccount(orgId) {
      if (orgId !== "org-1") return null;
      return { stripeAccountId: "acct_connect_1", status: "ready" };
    },
    ...overrides,
  };
}

describe("issueStripeRefund", () => {
  it("creates a Stripe refund without writing payment status locally", async () => {
    const create = vi.fn(async () => ({ id: "re_1", status: "succeeded" }));
    const result = await issueStripeRefund({
      paymentId: "pay-1",
      store: store(),
      stripe: { refunds: { create } },
    });
    expect(result).toEqual({ ok: true, stripeRefundId: "re_1" });
    expect(create).toHaveBeenCalledWith(
      { charge: "ch_1", reason: "requested_by_customer" },
      { stripeAccount: "acct_connect_1", idempotencyKey: "lawnquoter_refund_pay-1" },
    );
  });

  it("rejects when payment is already refunded", async () => {
    const create = vi.fn();
    const result = await issueStripeRefund({
      paymentId: "pay-1",
      store: store({
        async loadPayment() {
          return {
            id: "pay-1",
            orgId: "org-1",
            status: "refunded",
            amountCents: 12500,
            stripeChargeId: "ch_1",
            stripePaymentIntentId: "pi_1",
          };
        },
      }),
      stripe: { refunds: { create } },
    });
    expect(result).toEqual({ ok: false, error: "Payment is already refunded." });
    expect(create).not.toHaveBeenCalled();
  });
});
