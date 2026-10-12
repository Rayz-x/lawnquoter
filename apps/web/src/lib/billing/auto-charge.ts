export function shouldAutoCharge(input: {
  autoCharge: boolean;
  hasDefaultMethod: boolean;
  source: string;
}): boolean {
  return input.autoCharge && input.hasDefaultMethod && input.source === "visit";
}

export function offSessionPaymentIntentParams(input: {
  amountCents: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
  invoiceId: string;
  orgId: string;
  accountId: string;
}) {
  return {
    amount: input.amountCents,
    currency: input.currency.toLowerCase(),
    customer: input.customerId,
    payment_method: input.paymentMethodId,
    off_session: true as const,
    confirm: true as const,
    error_on_requires_action: true as const,
    metadata: {
      lawnquoter_invoice_id: input.invoiceId,
      lawnquoter_org_id: input.orgId,
      lawnquoter_account_id: input.accountId,
      lawnquoter_purpose: "auto_charge",
    },
  };
}

export function autoChargeIdempotencyKey(invoiceId: string) {
  return `lawnquoter_auto_${invoiceId}`;
}

export type AutoChargeInvoice = {
  id: string;
  source: string;
  status: string;
  totalCents: number;
  currency: string;
  orgId: string;
  accountId: string;
};

export async function chargeIssuedVisit(deps: {
  invoice: AutoChargeInvoice;
  autoCharge: boolean;
  stripeCustomerId: string | null;
  paymentMethodId: string | null;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  stripeKeyPresent: boolean;
  createPaymentIntent: (
    params: ReturnType<typeof offSessionPaymentIntentParams>,
    opts: { stripeAccount: string; idempotencyKey: string },
  ) => Promise<unknown>;
}): Promise<boolean> {
  if (deps.invoice.status !== "issued" || deps.invoice.totalCents <= 0) return false;
  if (!deps.stripeKeyPresent || !deps.chargesEnabled || !deps.stripeAccountId) return false;
  if (!deps.stripeCustomerId || !deps.paymentMethodId) return false;
  if (
    !shouldAutoCharge({
      autoCharge: deps.autoCharge,
      hasDefaultMethod: true,
      source: deps.invoice.source,
    })
  ) {
    return false;
  }
  try {
    await deps.createPaymentIntent(
      offSessionPaymentIntentParams({
        amountCents: Math.trunc(deps.invoice.totalCents),
        currency: deps.invoice.currency,
        customerId: deps.stripeCustomerId,
        paymentMethodId: deps.paymentMethodId,
        invoiceId: deps.invoice.id,
        orgId: deps.invoice.orgId,
        accountId: deps.invoice.accountId,
      }),
      {
        stripeAccount: deps.stripeAccountId,
        idempotencyKey: autoChargeIdempotencyKey(deps.invoice.id),
      },
    );
    return true;
  } catch {
    return false;
  }
}
