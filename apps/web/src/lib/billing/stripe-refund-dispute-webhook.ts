export type RefundDisputePayment = {
  id: string;
  orgId: string;
  accountId: string;
  invoiceId: string | null;
  status: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  stripeRefundId: string | null;
};

export type RefundDisputeStore = {
  claimEvent: (
    eventId: string,
    eventType: string,
    orgId: string | null,
    payload: unknown,
  ) => Promise<{ claimed: boolean }>;
  findPaymentByChargeId: (chargeId: string) => Promise<RefundDisputePayment | null>;
  findPaymentByPaymentIntentId: (
    paymentIntentId: string,
  ) => Promise<RefundDisputePayment | null>;
  markPaymentRefunded: (input: {
    paymentId: string;
    stripeRefundId: string | null;
    amountCents: number;
  }) => Promise<{ recorded: boolean }>;
  flagDispute: (input: {
    invoiceId: string;
    accountId: string;
    orgId: string;
    stripeDisputeId: string;
    deadline: string | null;
  }) => Promise<void>;
  clearDispute: (input: {
    invoiceId: string;
    accountId: string;
    stripeDisputeId: string;
  }) => Promise<void>;
};

export type StripeRefundDisputeEvent = {
  id: string;
  type: string;
  object: {
    id: string;
    object?: string;
    payment_intent?: string | { id: string } | null;
    charge?: string | { id: string } | null;
    amount_refunded?: number | null;
    status?: string | null;
    refunds?: { data?: Array<{ id: string; amount?: number | null }> | null } | null;
    evidence_details?: { due_by?: number | null } | null;
  };
};

export type RefundDisputeOutcome =
  | "ignored"
  | "duplicate"
  | "refunded"
  | "dispute_flagged"
  | "dispute_cleared"
  | "missing_payment"
  | "missing_invoice";

const EVENT_TYPES = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);

function asId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

async function resolvePayment(
  store: RefundDisputeStore,
  object: StripeRefundDisputeEvent["object"],
): Promise<RefundDisputePayment | null> {
  if (object.object === "charge") {
    const byCharge = await store.findPaymentByChargeId(object.id);
    if (byCharge) return byCharge;
    const pi = asId(object.payment_intent);
    return pi ? store.findPaymentByPaymentIntentId(pi) : null;
  }

  const chargeId = asId(object.charge);
  if (chargeId) {
    const byCharge = await store.findPaymentByChargeId(chargeId);
    if (byCharge) return byCharge;
  }
  const pi = asId(object.payment_intent);
  return pi ? store.findPaymentByPaymentIntentId(pi) : null;
}

export async function applyStripeRefundDisputeEvent(deps: {
  event: StripeRefundDisputeEvent;
  store: RefundDisputeStore;
}): Promise<{ ok: true; outcome: RefundDisputeOutcome }> {
  const { event, store } = deps;
  if (!EVENT_TYPES.has(event.type)) {
    return { ok: true, outcome: "ignored" };
  }

  const payment = await resolvePayment(store, event.object);
  const orgId = payment?.orgId ?? null;

  const claimed = await store.claimEvent(event.id, event.type, orgId, event.object);
  if (!claimed.claimed) return { ok: true, outcome: "duplicate" };

  if (!payment) return { ok: true, outcome: "missing_payment" };
  if (!payment.invoiceId) return { ok: true, outcome: "missing_invoice" };

  if (event.type === "charge.refunded") {
    const refund = event.object.refunds?.data?.[0] ?? null;
    await store.markPaymentRefunded({
      paymentId: payment.id,
      stripeRefundId: refund?.id ?? null,
      amountCents:
        typeof refund?.amount === "number"
          ? refund.amount
          : typeof event.object.amount_refunded === "number"
            ? event.object.amount_refunded
            : 0,
    });
    return { ok: true, outcome: "refunded" };
  }

  if (event.type === "charge.dispute.created") {
    const dueBy = event.object.evidence_details?.due_by;
    await store.flagDispute({
      invoiceId: payment.invoiceId,
      accountId: payment.accountId,
      orgId: payment.orgId,
      stripeDisputeId: event.object.id,
      deadline: typeof dueBy === "number" ? new Date(dueBy * 1000).toISOString() : null,
    });
    return { ok: true, outcome: "dispute_flagged" };
  }

  await store.clearDispute({
    invoiceId: payment.invoiceId,
    accountId: payment.accountId,
    stripeDisputeId: event.object.id,
  });
  return { ok: true, outcome: "dispute_cleared" };
}
