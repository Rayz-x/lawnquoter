import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const accountsCreate = vi.fn();
  const accountLinksCreate = vi.fn();
  const createLoginLink = vi.fn();
  const maybeSingle = vi.fn();
  const upsert = vi.fn();
  const requireOrg = vi.fn();
  const userFrom = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: harness.maybeSingle }) }),
  }));
  const adminFrom = vi.fn(() => ({
    upsert: harness.upsert,
  }));
  return {
    accountsCreate,
    accountLinksCreate,
    createLoginLink,
    maybeSingle,
    upsert,
    requireOrg,
    userFrom,
    adminFrom,
  };
});

vi.mock("@/lib/auth/session", () => ({ requireOrg: () => harness.requireOrg() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: harness.userFrom }),
  createAdminClient: () => ({ from: harness.adminFrom }),
}));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    accounts: {
      create: harness.accountsCreate,
      createLoginLink: harness.createLoginLink,
    },
    accountLinks: { create: harness.accountLinksCreate },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { openStripeDashboard, startStripeConnect } from "./stripe-connect-actions";

const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  for (const fn of [
    harness.accountsCreate,
    harness.accountLinksCreate,
    harness.createLoginLink,
    harness.maybeSingle,
    harness.upsert,
    harness.requireOrg,
    harness.userFrom,
    harness.adminFrom,
  ]) {
    fn.mockReset();
  }
  harness.userFrom.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: harness.maybeSingle }) }),
  }));
  harness.adminFrom.mockImplementation(() => ({
    upsert: harness.upsert,
  }));
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  harness.requireOrg.mockResolvedValue({ orgId: ORG, orgRole: "owner", userId: "u1", email: "o@x.com" });
  harness.maybeSingle.mockResolvedValue({ data: null, error: null });
  harness.upsert.mockResolvedValue({ error: null });
  harness.accountsCreate.mockResolvedValue({ id: "acct_1" });
  harness.accountLinksCreate.mockResolvedValue({ url: "https://connect.stripe.com/setup/e/acct_1" });
  harness.createLoginLink.mockResolvedValue({ url: "https://connect.stripe.com/express/acct_1" });
});

describe("startStripeConnect", () => {
  it("creates or reuses one connected account per company via the idempotency key", async () => {
    expect(await startStripeConnect()).toEqual({
      ok: true,
      data: { url: "https://connect.stripe.com/setup/e/acct_1" },
    });
    expect(harness.accountsCreate).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: `lawnquoter_connect_${ORG}`,
    });
    expect(harness.adminFrom).toHaveBeenCalledWith("org_stripe_connect");
    expect(harness.upsert).toHaveBeenCalledWith(
      {
        org_id: ORG,
        stripe_account_id: "acct_1",
        charges_enabled: false,
        payouts_enabled: false,
        status: "pending",
      },
      { onConflict: "org_id" },
    );
    harness.maybeSingle.mockResolvedValue({ data: { stripe_account_id: "acct_1", status: "pending" }, error: null });
    harness.accountsCreate.mockClear();
    harness.upsert.mockClear();
    harness.adminFrom.mockClear();
    expect(await startStripeConnect()).toEqual({
      ok: true,
      data: { url: "https://connect.stripe.com/setup/e/acct_1" },
    });
    expect(harness.accountsCreate).not.toHaveBeenCalled();
    expect(harness.upsert).not.toHaveBeenCalled();
  });
});

describe("openStripeDashboard", () => {
  it("opens an Express login link when Connect is ready", async () => {
    harness.maybeSingle.mockResolvedValue({
      data: { stripe_account_id: "acct_1", status: "ready" },
      error: null,
    });
    expect(await openStripeDashboard()).toEqual({
      ok: true,
      data: { url: "https://connect.stripe.com/express/acct_1" },
    });
    expect(harness.createLoginLink).toHaveBeenCalledWith("acct_1");
    expect(harness.adminFrom).not.toHaveBeenCalled();
  });

  it("rejects when Connect is not ready", async () => {
    harness.maybeSingle.mockResolvedValue({
      data: { stripe_account_id: "acct_1", status: "pending" },
      error: null,
    });
    expect(await openStripeDashboard()).toEqual({
      ok: false,
      error: "Stripe Connect is not ready yet.",
    });
  });
});
