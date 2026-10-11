export type LedgerPaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "refunded";

export type PaymentMethodDetails = {
  brand: string | null;
  last4: string | null;
  type: string | null;
};

export type PaymentWebhookInvoice = {
  id: string;
  orgId: string;
  accountId: string;
  status: string;
  totalCents: number;
  currency: string;
  number: number | null;
};

export type PaymentUpsert = {
  orgId: string;
  accountId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  status: LedgerPaymentStatus;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeChargeId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  receivedAt: string | null;
};

export type PaymentWebhookStore = {
  claimEvent: (
    eventId: string,
    eventType: string,
    orgId: string | null,
    payload: unknown,
  ) => Promise<{ claimed: boolean }>;
  findInvoiceById: (invoiceId: string) => Promise<PaymentWebhookInvoice | null>;
  upsertPayment: (row: PaymentUpsert) => Promise<{ id: string }>;
  markInvoicePaid: (invoiceId: string) => Promise<void>;
  reopenInvoice: (invoiceId: string) => Promise<void>;
  alertOfficeAchFailed: (input: {
    orgId: string;
    invoiceId: string;
    invoiceNumber: number | null;
    amountCents: number;
    stripePaymentIntentId: string | null;
  }) => Promise<void>;
};

export type StripePaymentEvent = {
  id: string;
  type: string;
  object: {
    id: string;
    object?: string;
    payment_status?: string | null;
    status?: string | null;
    amount_total?: number | null;
    amount?: number | null;
    currency?: string | null;
    payment_intent?: string | { id: string } | null;
    latest_charge?: string | { id: string } | null;
    metadata?: Record<string, string> | null;
    payment_method_types?: string[] | null;
  };
};

export type PaymentEventOutcome =
  | "ignored"
  | "duplicate"
  | "paid"
  | "processing"
  | "failed_reopened"
  | "missing_invoice";

const PAYMENT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
]);

function meta(object: StripePaymentEvent["object"], key: string): string | null {
  const value = object.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeCardField(value: string | null | undefined, max = 32): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function sanitizeLast4(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export async function applyStripePaymentEvent(deps: {
  event: StripePaymentEvent;
  store: PaymentWebhookStore;
  paymentMethodDetails: (paymentIntentId: string | null) => Promise<PaymentMethodDetails | null>;
}): Promise<{ ok: true; outcome: PaymentEventOutcome }> {
  const { event, store } = deps;
  if (!PAYMENT_EVENT_TYPES.has(event.type)) {
    return { ok: true, outcome: "ignored" };
  }

  const invoiceId = meta(event.object, "lawnquoter_invoice_id");
  const orgId = meta(event.object, "lawnquoter_org_id");
  const accountId = meta(event.object, "lawnquoter_account_id");

  const claimed = await store.claimEvent(event.id, event.type, orgId, event.object);
  if (!claimed.claimed) return { ok: true, outcome: "duplicate" };

  if (!invoiceId) return { ok: true, outcome: "missing_invoice" };
  const invoice = await store.findInvoiceById(invoiceId);
  if (!invoice) return { ok: true, outcome: "missing_invoice" };

  const paymentIntentId =
    event.object.object === "payment_intent"
      ? event.object.id
      : asId(event.object.payment_intent);
  const checkoutSessionId =
    event.object.object === "checkout.session" ? event.object.id : null;
  const chargeId = asId(event.object.latest_charge);
  const amountCents =
    typeof event.object.amount_total === "number"
      ? event.object.amount_total
      : typeof event.object.amount === "number"
        ? event.object.amount
        : invoice.totalCents;
  const currency = (event.object.currency ?? invoice.currency).toLowerCase();
  const details = await deps.paymentMethodDetails(paymentIntentId);

  let status: LedgerPaymentStatus;
  let outcome: PaymentEventOutcome;

  if (event.type === "payment_intent.payment_failed") {
    status = "failed";
    outcome = "failed_reopened";
  } else if (
    event.type === "payment_intent.processing" ||
    (event.type === "checkout.session.completed" && event.object.payment_status !== "paid")
  ) {
    status = "processing";
    outcome = "processing";
  } else {
    status = "succeeded";
    outcome = "paid";
  }

  await store.upsertPayment({
    orgId: orgId ?? invoice.orgId,
    accountId: accountId ?? invoice.accountId,
    invoiceId: invoice.id,
    amountCents: Math.trunc(amountCents),
    currency,
    status,
    stripePaymentIntentId: paymentIntentId,
    stripeCheckoutSessionId: checkoutSessionId,
    stripeChargeId: chargeId,
    cardBrand: sanitizeCardField(details?.brand),
    cardLast4: sanitizeLast4(details?.last4),
    receivedAt: status === "succeeded" ? nowIso() : null,
  });

  if (outcome === "paid") {
    await store.markInvoicePaid(invoice.id);
  } else if (outcome === "failed_reopened") {
    await store.reopenInvoice(invoice.id);
    await store.alertOfficeAchFailed({
      orgId: orgId ?? invoice.orgId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amountCents: Math.trunc(amountCents),
      stripePaymentIntentId: paymentIntentId,
    });
  }

  return { ok: true, outcome };
}
