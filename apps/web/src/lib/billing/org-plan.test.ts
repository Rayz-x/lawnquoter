import { describe, expect, it } from "vitest";
import { orgBillingGate, orgPlanCheckout, orgPlanPatch } from "./org-plan";

const PRICES = {
  price_starter: "starter",
  price_growth: "growth",
  price_scale: "scale",
} as const;

describe("org billing", () => {
  it("stays off until a test key and the billing flag are both set", () => {
    expect(orgBillingGate({ secretKey: undefined, enabled: undefined })).toEqual({
      ok: false,
      message: "Not connected - add STRIPE_SECRET_KEY to enable.",
    });
    expect(orgBillingGate({ secretKey: "sk_test_123", enabled: undefined })).toEqual({
      ok: false,
      message: "Stripe Billing is off.",
    });
    expect(orgBillingGate({ secretKey: "sk_live_123", enabled: "1" })).toEqual({
      ok: false,
      message: "Stripe Billing stays in test mode. Use a test key.",
    });
    expect(orgBillingGate({ secretKey: "sk_test_123", enabled: "1" })).toEqual({ ok: true });
  });

  it("checks out one flat price for the company", () => {
    expect(
      orgPlanCheckout({
        orgId: "org-1",
        tier: "growth",
        priceId: "price_growth",
        successUrl: "https://app.example/settings?tab=payments",
        cancelUrl: "https://app.example/settings?tab=payments",
      }),
    ).toEqual({
      mode: "subscription",
      line_items: [{ price: "price_growth", quantity: 1 }],
      success_url: "https://app.example/settings?tab=payments",
      cancel_url: "https://app.example/settings?tab=payments",
      client_reference_id: "org-1",
      metadata: { lawnquoter_org_id: "org-1", lawnquoter_purpose: "org_plan", lawnquoter_tier: "growth" },
      subscription_data: {
        metadata: { lawnquoter_org_id: "org-1", lawnquoter_purpose: "org_plan", lawnquoter_tier: "growth" },
      },
    });
  });

  it("records an active plan from the Stripe price and cancels by subscription id", () => {
    expect(
      orgPlanPatch({
        type: "customer.subscription.updated",
        purpose: "org_plan",
        orgId: "org-1",
        priceId: "price_starter",
        status: "active",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        periodEnd: 1_800_000_000,
        prices: PRICES,
      }),
    ).toEqual({
      kind: "upsert",
      orgId: "org-1",
      tier: "starter",
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: "2027-01-15T08:00:00.000Z",
    });
    expect(
      orgPlanPatch({
        type: "customer.subscription.deleted",
        purpose: "org_plan",
        orgId: "org-1",
        priceId: "price_starter",
        status: "canceled",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        periodEnd: null,
        prices: PRICES,
      }),
    ).toEqual({ kind: "cancel", stripeSubscriptionId: "sub_1" });
    expect(
      orgPlanPatch({
        type: "customer.subscription.deleted",
        purpose: null,
        orgId: "org-1",
        priceId: "price_starter",
        status: "canceled",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        periodEnd: null,
        prices: PRICES,
      }),
    ).toBeNull();
    expect(
      orgPlanPatch({
        type: "customer.subscription.updated",
        purpose: "org_plan",
        orgId: "org-1",
        priceId: "price_unknown",
        status: "active",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        periodEnd: null,
        prices: PRICES,
      }),
    ).toBeNull();
  });
});
