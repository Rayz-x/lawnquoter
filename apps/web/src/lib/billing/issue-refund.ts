export type IssueRefundPayment = {
  id: string;
  orgId: string;
  status: string;
  amountCents: number;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
};

export type IssueRefundStore = {
  loadPayment: (paymentId: string) => Promise<IssueRefundPayment | null>;
  loadConnectAccount: (
    orgId: string,
  ) => Promise<{ stripeAccountId: string; status: string } | null>;
};

export type StripeRefundClient = {
  refunds: {
    create: (
      params: { charge: string; reason?: string },
      options?: { stripeAccount?: string; idempotencyKey?: string },
    ) => Promise<{ id: string; status?: string | null }>;
  };
};

export async function issueStripeRefund(deps: {
  paymentId: string;
  store: IssueRefundStore;
  stripe: StripeRefundClient;
}): Promise<{ ok: true; stripeRefundId: string } | { ok: false; error: string }> {
  const payment = await deps.store.loadPayment(deps.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.status === "refunded") return { ok: false, error: "Payment is already refunded." };
  if (payment.status !== "succeeded") {
    return { ok: false, error: "Only succeeded payments can be refunded." };
  }
  if (!payment.stripeChargeId) {
    return { ok: false, error: "Payment has no Stripe charge to refund." };
  }

  const connect = await deps.store.loadConnectAccount(payment.orgId);
  if (!connect?.stripeAccountId || connect.status !== "ready") {
    return { ok: false, error: "Stripe Connect is not ready." };
  }

  const refund = await deps.stripe.refunds.create(
    { charge: payment.stripeChargeId, reason: "requested_by_customer" },
    {
      stripeAccount: connect.stripeAccountId,
      idempotencyKey: `lawnquoter_refund_${payment.id}`,
    },
  );

  // Payment status is written only when charge.refunded arrives (webhook).
  return { ok: true, stripeRefundId: refund.id };
}
