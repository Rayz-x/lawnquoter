export const ORG_PLAN_TIERS = ["starter", "growth", "scale"] as const;
export type OrgPlanTier = (typeof ORG_PLAN_TIERS)[number];

const PRICE_ENV: Record<OrgPlanTier, string> = {
  starter: "STRIPE_PRICE_STARTER",
  growth: "STRIPE_PRICE_GROWTH",
  scale: "STRIPE_PRICE_SCALE",
};

const OFF = "Stripe Billing is off.";
const LIVE = "Stripe Billing stays in test mode. Use a test key.";
const MISSING = "Not connected - add STRIPE_SECRET_KEY to enable.";

export function orgBillingGate(input: { secretKey: string | undefined; enabled: string | undefined }): { ok: true } | { ok: false; message: string } {
  const key = input.secretKey?.trim() ?? "";
  if (!key) return { ok: false, message: MISSING };
  if (key.startsWith("sk_live_") || !key.startsWith("sk_test_")) return { ok: false, message: LIVE };
  if (input.enabled !== "1") return { ok: false, message: OFF };
  return { ok: true };
}

export function orgPlanCheckout(input: {
  orgId: string;
  tier: OrgPlanTier;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const metadata = { lawnquoter_org_id: input.orgId, lawnquoter_purpose: "org_plan", lawnquoter_tier: input.tier };
  return {
    mode: "subscription" as const,
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    metadata,
    subscription_data: { metadata },
  };
}

const STATUS = {
  active: "active",
  trialing: "active",
  past_due: "past_due",
  unpaid: "past_due",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  canceled: "canceled",
} as const;

export type OrgPlanWrite =
  | {
      kind: "upsert";
      orgId: string;
      tier: OrgPlanTier;
      status: (typeof STATUS)[keyof typeof STATUS];
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      currentPeriodEnd: string | null;
    }
  | { kind: "cancel"; stripeSubscriptionId: string };

export function orgPlanPatch(input: {
  type: string;
  purpose: string | null;
  orgId: string | null;
  priceId: string | null;
  status: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  periodEnd: number | null;
  prices: Record<string, OrgPlanTier>;
}): OrgPlanWrite | null {
  if (input.purpose !== "org_plan") return null;
  if (input.type === "customer.subscription.deleted") {
    return input.subscriptionId ? { kind: "cancel", stripeSubscriptionId: input.subscriptionId } : null;
  }
  if (input.type !== "customer.subscription.updated" && input.type !== "customer.subscription.created") return null;
  if (!input.orgId || !input.priceId || !input.status) return null;
  const tier = input.prices[input.priceId];
  const status = STATUS[input.status as keyof typeof STATUS];
  if (!tier || !status) return null;
  return {
    kind: "upsert",
    orgId: input.orgId,
    tier,
    status,
    stripeCustomerId: input.customerId,
    stripeSubscriptionId: input.subscriptionId,
    currentPeriodEnd: input.periodEnd == null ? null : new Date(input.periodEnd * 1000).toISOString(),
  };
}

export function orgPlanPriceId(tier: OrgPlanTier, env: Record<string, string | undefined>): string | undefined {
  return env[PRICE_ENV[tier]];
}

export function orgPlanPrices(env: Record<string, string | undefined>): Record<string, OrgPlanTier> {
  const prices: Record<string, OrgPlanTier> = {};
  for (const tier of ORG_PLAN_TIERS) {
    const id = env[PRICE_ENV[tier]];
    if (id) prices[id] = tier;
  }
  return prices;
}
