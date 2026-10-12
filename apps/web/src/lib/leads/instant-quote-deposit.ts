export function depositAmountCents(settingCents: number | null, offerLow: number): number | null {
  if (settingCents != null && Number.isInteger(settingCents) && settingCents > 0) return settingCents;
  if (!Number.isFinite(offerLow) || offerLow <= 0) return null;
  const cents = Math.round(offerLow * 100);
  return cents > 0 ? cents : null;
}

export type DepositCheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; reason: "not_connected" | "missing_checkout_url" };

/** Checkout Session on the company's Connect account. A missing account never calls Stripe. */
export async function startDepositCheckout(deps: {
  stripeAccountId: string | null;
  amountCents: number;
  leadId: string;
  orgId: string;
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
}): Promise<DepositCheckoutResult> {
  if (!deps.stripeAccountId || !Number.isFinite(deps.amountCents) || deps.amountCents <= 0) {
    return { ok: false, reason: "not_connected" };
  }
  const session = await deps.stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card", "us_bank_account"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.trunc(deps.amountCents),
            product_data: { name: "Deposit to lock your quote" },
          },
        },
      ],
      success_url: deps.successUrl,
      cancel_url: deps.cancelUrl,
      client_reference_id: deps.leadId,
      metadata: {
        lawnquoter_lead_id: deps.leadId,
        lawnquoter_org_id: deps.orgId,
        lawnquoter_kind: "instant_quote_deposit",
      },
    },
    {
      stripeAccount: deps.stripeAccountId,
      idempotencyKey: `lawnquoter_instant_quote_deposit_${deps.leadId}`,
    },
  );
  if (!session.url) return { ok: false, reason: "missing_checkout_url" };
  return { ok: true, url: session.url, sessionId: session.id };
}
