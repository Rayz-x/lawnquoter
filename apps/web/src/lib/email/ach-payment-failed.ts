import type { OutboundEmail } from "./provider";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (Number.isFinite(cents) ? cents : 0) / 100,
  );
}

export function achPaymentFailedMessage(input: {
  to: string;
  orgName: string;
  invoiceNumber: number | null;
  amountCents: number;
  stripePaymentIntentId: string | null;
}): OutboundEmail {
  const label = input.invoiceNumber == null ? "an invoice" : `invoice INV-${input.invoiceNumber}`;
  const amount = formatUsd(input.amountCents);
  const pi = input.stripePaymentIntentId ? `\nStripe payment: ${input.stripePaymentIntentId}` : "";
  const text = `An ACH payment failed for ${label} (${amount}).

The invoice is open again so the customer can retry.${pi}
`;
  const html = `<p>An ACH payment failed for ${escapeHtml(label)} (${escapeHtml(amount)}).</p>
<p>The invoice is open again so the customer can retry.</p>
${input.stripePaymentIntentId ? `<p>Stripe payment: ${escapeHtml(input.stripePaymentIntentId)}</p>` : ""}`;

  return {
    to: input.to,
    subject: `ACH payment failed — ${input.orgName}`,
    text,
    html,
  };
}
