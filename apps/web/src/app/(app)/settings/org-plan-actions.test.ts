import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
const requireOrg = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requireOrg }));
vi.mock("@/lib/stripe/client", () => ({ getStripe: () => ({ checkout: { sessions: { create } } }) }));

import { startOrgPlan } from "./org-plan-actions";

const owner = { userId: "user-1", email: null, orgId: "org-1", orgRole: "owner" as const };

beforeEach(() => {
  create.mockReset();
  requireOrg.mockResolvedValue(owner);
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_BILLING_ENABLED;
  delete process.env.STRIPE_PRICE_GROWTH;
});

describe("startOrgPlan", () => {
  it("does not call Stripe when billing is off or the key is live", async () => {
    expect(await startOrgPlan("growth")).toEqual({ ok: false, error: "Not connected - add STRIPE_SECRET_KEY to enable." });
    process.env.STRIPE_SECRET_KEY = "sk_live_secret";
    process.env.STRIPE_BILLING_ENABLED = "1";
    expect(await startOrgPlan("growth")).toEqual({ ok: false, error: "Stripe Billing stays in test mode. Use a test key." });
    process.env.STRIPE_SECRET_KEY = "sk_test_secret";
    delete process.env.STRIPE_BILLING_ENABLED;
    expect(await startOrgPlan("growth")).toEqual({ ok: false, error: "Stripe Billing is off." });
    expect(create).not.toHaveBeenCalled();
  });

  it("opens one test-mode subscription checkout for the company", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_secret";
    process.env.STRIPE_BILLING_ENABLED = "1";
    process.env.STRIPE_PRICE_GROWTH = "price_growth";
    create.mockResolvedValue({ url: "https://checkout.stripe.test/c/pay" });
    expect(await startOrgPlan("growth")).toEqual({ ok: true, data: { url: "https://checkout.stripe.test/c/pay" } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ mode: "subscription", line_items: [{ price: "price_growth", quantity: 1 }] }));
  });
});
