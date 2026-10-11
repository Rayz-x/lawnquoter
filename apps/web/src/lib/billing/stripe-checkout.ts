export type CheckoutInvoice = {
  id: string;
  orgId: string;
  accountId: string;
  number: number | null;
  numberLabel: string | null;
  status: string;
  currency: string;
  totalCents: number;
  publicToken: string;
};

export function checkoutIdempotencyKey(invoiceId: string) {
  return `lawnquoter_invoice_checkout_${invoiceId}`;
}

function invoiceLabel(invoice: Pick<CheckoutInvoice, "number" | "numberLabel">) {
  if (invoice.numberLabel) return `Invoice ${invoice.numberLabel}`;
  if (invoice.number == null) return "Invoice";
  return `Invoice INV-${invoice.number}`;
}

export type StartInvoiceCheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; reason: "not_payable" | "connect_not_ready" | "missing_checkout_url" };

export async function startInvoiceCheckout(deps: {
  invoice: CheckoutInvoice;
  stripeAccountId: string | null;
  successUrl: string;
  cancelUrl: string;
  stripe: {
    checkout: {
      sessions: {
        create: (
          params: object,
          opts?: { stripeAccount: string; idempotencyKey: string },
        ) => Promise<{ id: string; url: string | null }>;
      };
    };
  };
}): Promise<StartInvoiceCheckoutResult> {
  const { invoice, stripeAccountId } = deps;
  if (!stripeAccountId) return { ok: false, reason: "connect_not_ready" };
  if (invoice.status !== "issued" || !Number.isFinite(invoice.totalCents) || invoice.totalCents <= 0) {
    return { ok: false, reason: "not_payable" };
  }

  const metadata = {
    lawnquoter_invoice_id: invoice.id,
    lawnquoter_org_id: invoice.orgId,
    lawnquoter_account_id: invoice.accountId,
    lawnquoter_public_token: invoice.publicToken,
  };

  const session = await deps.stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card", "us_bank_account"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: invoice.currency.toLowerCase(),
            unit_amount: Math.trunc(invoice.totalCents),
            product_data: { name: invoiceLabel(invoice) },
          },
        },
      ],
      success_url: deps.successUrl,
      cancel_url: deps.cancelUrl,
      client_reference_id: invoice.id,
      metadata,
      payment_intent_data: {
        metadata: {
          lawnquoter_invoice_id: invoice.id,
          lawnquoter_org_id: invoice.orgId,
          lawnquoter_account_id: invoice.accountId,
        },
      },
    },
    {
      stripeAccount: stripeAccountId,
      idempotencyKey: checkoutIdempotencyKey(invoice.id),
    },
  );

  if (!session.url) return { ok: false, reason: "missing_checkout_url" };
  return { ok: true, url: session.url, sessionId: session.id };
}
