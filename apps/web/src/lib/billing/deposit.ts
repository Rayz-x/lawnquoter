import type { CheckoutInvoice } from "./stripe-checkout";

export const DEPOSIT_NOT_CONNECTED = "Not connected - add a Stripe key to enable.";

export function depositCents(amount: number | string | null | undefined): number {
  if (amount == null || amount === "") return 0;
  const dollars = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(dollars) || dollars <= 0) return 0;
  return Math.round(dollars * 100);
}

function invoiceLabel(invoice: Pick<CheckoutInvoice, "number" | "numberLabel">) {
  if (invoice.numberLabel) return `Deposit ${invoice.numberLabel}`;
  return "Deposit";
}

export function depositCheckoutParams(input: {
  invoice: CheckoutInvoice;
  successUrl: string;
  cancelUrl: string;
}) {
  const metadata = {
    lawnquoter_invoice_id: input.invoice.id,
    lawnquoter_org_id: input.invoice.orgId,
    lawnquoter_account_id: input.invoice.accountId,
    lawnquoter_public_token: input.invoice.publicToken,
    lawnquoter_purpose: "deposit",
  };
  return {
    mode: "payment" as const,
    payment_method_types: ["card", "us_bank_account"] as const,
    payment_method_options: {
      us_bank_account: { verification_method: "instant" as const },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.invoice.currency.toLowerCase(),
          unit_amount: Math.trunc(input.invoice.totalCents),
          product_data: { name: invoiceLabel(input.invoice) },
        },
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.invoice.id,
    metadata,
    payment_intent_data: {
      setup_future_usage: "off_session" as const,
      metadata: {
        lawnquoter_invoice_id: input.invoice.id,
        lawnquoter_org_id: input.invoice.orgId,
        lawnquoter_account_id: input.invoice.accountId,
        lawnquoter_purpose: "deposit",
      },
    },
  };
}
