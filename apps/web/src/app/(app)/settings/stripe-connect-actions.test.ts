import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const accountsCreate = vi.fn();
  const accountLinksCreate = vi.fn();
  const maybeSingle = vi.fn();
  const upsert = vi.fn();
  const requireOrg = vi.fn();
  return {
    accountsCreate,
    accountLinksCreate,
    maybeSingle,
    upsert,
    requireOrg,
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: harness.maybeSingle }) }),
      upsert: harness.upsert,
    })),
  };
});

vi.mock("@/lib/auth/session", () => ({ requireOrg: () => harness.requireOrg() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: harness.from }) }));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    accounts: { create: harness.accountsCreate },
    accountLinks: { create: harness.accountLinksCreate },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { startStripeConnect } from "./stripe-connect-actions";

const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  for (const fn of [harness.accountsCreate, harness.accountLinksCreate, harness.maybeSingle, harness.upsert, harness.requireOrg]) {
    fn.mockReset();
  }
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  harness.requireOrg.mockResolvedValue({ orgId: ORG, orgRole: "owner", userId: "u1", email: "o@x.com" });
  harness.maybeSingle.mockResolvedValue({ data: null, error: null });
  harness.upsert.mockResolvedValue({ error: null });
  harness.accountsCreate.mockResolvedValue({ id: "acct_1" });
  harness.accountLinksCreate.mockResolvedValue({ url: "https://connect.stripe.com/setup/e/acct_1" });
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
    harness.maybeSingle.mockResolvedValue({ data: { stripe_account_id: "acct_1", status: "pending" }, error: null });
    harness.accountsCreate.mockClear();
    expect(await startStripeConnect()).toEqual({
      ok: true,
      data: { url: "https://connect.stripe.com/setup/e/acct_1" },
    });
    expect(harness.accountsCreate).not.toHaveBeenCalled();
  });
});
