export type SavedCard = {
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  kind: "card" | "us_bank_account";
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

export type CardSetupSession = {
  mode?: string | null;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  setup_intent?:
    | string
    | {
        id: string;
        payment_method?:
          | string
          | {
              id: string;
              type?: string | null;
              card?: {
                brand?: string | null;
                last4?: string | null;
                exp_month?: number | null;
                exp_year?: number | null;
              } | null;
              us_bank_account?: { bank_name?: string | null; last4?: string | null } | null;
            }
          | null;
      }
    | null;
};

export function cardOnFileLabel(card: Pick<SavedCard, "brand" | "last4" | "kind">): string {
  const brand =
    card.brand && card.brand.trim()
      ? card.brand.trim().slice(0, 1).toUpperCase() + card.brand.trim().slice(1)
      : card.kind === "us_bank_account"
        ? "Bank"
        : "Card";
  return card.last4 ? `${brand} ···· ${card.last4}` : brand;
}

/** Shown when the office cannot save a card yet. */
export function cardOnFileBlockedReason(input: { stripeKey: boolean; connectReady: boolean }): string | null {
  if (!input.stripeKey) return "Not connected - add a Stripe key to enable.";
  if (!input.connectReady) return "Connect Stripe in Settings before a card can be saved.";
  return null;
}

export function cardSetupCheckoutParams(input: {
  accountId: string;
  orgId: string;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const metadata = {
    lawnquoter_account_id: input.accountId,
    lawnquoter_org_id: input.orgId,
    lawnquoter_purpose: "card_on_file",
  };
  return {
    mode: "setup" as const,
    customer: input.customerId,
    payment_method_types: ["card", "us_bank_account"] as const,
    payment_method_options: {
      us_bank_account: { verification_method: "instant" as const },
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata,
    setup_intent_data: { metadata },
  };
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function cleanBrand(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed.slice(0, 32) : null;
}

function cleanLast4(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function cardFromSetupSession(
  session: CardSetupSession,
): { ok: true; orgId: string; accountId: string; card: SavedCard } | { ok: false; reason: "not_setup" | "missing_account" | "missing_method" } {
  if (session.mode !== "setup") return { ok: false, reason: "not_setup" };
  const orgId = session.metadata?.lawnquoter_org_id ?? "";
  const accountId = session.metadata?.lawnquoter_account_id ?? "";
  if (!orgId || !accountId || session.metadata?.lawnquoter_purpose !== "card_on_file") {
    return { ok: false, reason: "missing_account" };
  }
  const customerId = idOf(session.customer);
  const intent = session.setup_intent;
  const method = intent && typeof intent !== "string" ? intent.payment_method : null;
  if (!customerId || !method || typeof method === "string") return { ok: false, reason: "missing_method" };
  if (method.type !== "card" && method.type !== "us_bank_account") return { ok: false, reason: "missing_method" };
  if (method.type === "us_bank_account") {
    return {
      ok: true,
      orgId,
      accountId,
      card: {
        stripeCustomerId: customerId,
        stripePaymentMethodId: method.id,
        kind: "us_bank_account",
        brand: cleanBrand(method.us_bank_account?.bank_name),
        last4: cleanLast4(method.us_bank_account?.last4),
        expMonth: null,
        expYear: null,
      },
    };
  }
  return {
    ok: true,
    orgId,
    accountId,
    card: {
      stripeCustomerId: customerId,
      stripePaymentMethodId: method.id,
      kind: "card",
      brand: cleanBrand(method.card?.brand),
      last4: cleanLast4(method.card?.last4),
      expMonth: method.card?.exp_month ?? null,
      expYear: method.card?.exp_year ?? null,
    },
  };
}
