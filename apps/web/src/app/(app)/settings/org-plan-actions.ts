"use server";

import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { ORG_PLAN_TIERS, orgBillingGate, orgPlanCheckout, orgPlanPriceId, type OrgPlanTier } from "@/lib/billing/org-plan";
import { getStripe } from "@/lib/stripe/client";

function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Opens Stripe test-mode Checkout for one flat company plan. Live keys are refused, so this cannot charge a real card. */
export async function startOrgPlan(tier: string): Promise<ActionResult<{ url: string }>> {
  const session = await requireOrg();
  if (session.orgRole !== "owner") return fail("Only the company owner can choose a LawnQuoter plan.");
  const gate = orgBillingGate({ secretKey: process.env.STRIPE_SECRET_KEY, enabled: process.env.STRIPE_BILLING_ENABLED });
  if (!gate.ok) return fail(gate.message);
  if (!(ORG_PLAN_TIERS as readonly string[]).includes(tier)) return fail("Choose Starter, Growth, or Scale.");
  const chosen = tier as OrgPlanTier;
  const priceId = orgPlanPriceId(chosen, process.env);
  if (!priceId) return fail(`Add STRIPE_PRICE_${chosen.toUpperCase()} to enable this plan.`);
  const back = `${appOrigin()}/settings?tab=payments`;
  try {
    const checkout = await getStripe().checkout.sessions.create(
      orgPlanCheckout({ orgId: session.orgId, tier: chosen, priceId, successUrl: back, cancelUrl: back }),
    );
    if (!checkout.url) return fail("Stripe did not return a checkout link.");
    return { ok: true, data: { url: checkout.url } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not start the plan checkout.");
  }
}
