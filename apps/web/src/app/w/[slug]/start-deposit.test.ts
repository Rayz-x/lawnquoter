import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const loadInstantQuotePage = vi.fn();
  const connectMaybeSingle = vi.fn();
  const leadMaybeSingle = vi.fn();
  const sessionsCreate = vi.fn();
  return { loadInstantQuotePage, connectMaybeSingle, leadMaybeSingle, sessionsCreate };
});

vi.mock("@/lib/leads/load-public-form", () => ({ loadInstantQuotePage: harness.loadInstantQuotePage }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "org_stripe_connect") {
        return { select: () => ({ eq: () => ({ maybeSingle: harness.connectMaybeSingle }) }) };
      }
      if (table === "lead_requests") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: harness.leadMaybeSingle }) }) }) };
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
    },
  }),
}));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ checkout: { sessions: { create: harness.sessionsCreate } } }),
}));
vi.mock("@/lib/leads/instant-quote-price", () => ({
  instantQuoteFromCatalog: () => ({
    low: 50,
    high: 64.9,
    statedMinimum: 50,
    confirm: "We'll confirm within 24 hours",
  }),
}));

import { instantQuoteDepositAvailable, startInstantQuoteDeposit } from "./start-deposit";
import { emptyInstantQuote } from "@/lib/leads/instant-quote";

const draft = {
  ...emptyInstantQuote(),
  address: "1 Oak St",
  postalCode: "37064",
  service: "Mowing",
  hasGate: false,
  hasDogs: false,
  lotSqft: 8000,
  contactName: "Ada",
  email: "ada@example.com",
};

beforeEach(() => {
  harness.sessionsCreate.mockReset();
  harness.loadInstantQuotePage.mockReset();
  harness.connectMaybeSingle.mockReset();
  harness.leadMaybeSingle.mockReset();
  delete process.env.STRIPE_SECRET_KEY;
  harness.loadInstantQuotePage.mockResolvedValue({
    orgId: "org-1",
    orgName: "Acme",
    slug: "acme",
    services: ["Mowing"],
    consentText: "",
    responseTargetMinutes: 60,
    config: { serviceAreaZips: ["37064"], statedMinimum: 50, depositCents: null },
  });
  harness.connectMaybeSingle.mockResolvedValue({ data: { stripe_account_id: "acct_connected", status: "pending" }, error: null });
  harness.leadMaybeSingle.mockResolvedValue({ data: { id: "lead-1" }, error: null });
});

describe("instantQuoteDepositAvailable", () => {
  it("is off without a Stripe key and when Connect is not ready", async () => {
    expect(await instantQuoteDepositAvailable("org-1")).toBe(false);
    expect(harness.connectMaybeSingle).not.toHaveBeenCalled();
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(await instantQuoteDepositAvailable("org-1")).toBe(false);
    harness.connectMaybeSingle.mockResolvedValue({
      data: { stripe_account_id: "acct_connected", status: "ready" },
      error: null,
    });
    expect(await instantQuoteDepositAvailable("org-1")).toBe(true);
  });
});

describe("startInstantQuoteDeposit", () => {
  it("stays off and does not call Stripe when the secret is missing", async () => {
    const result = await startInstantQuoteDeposit("acme", "lead-1", draft);
    expect(result).toEqual({ ok: false, reason: "not_connected" });
    expect(harness.sessionsCreate).not.toHaveBeenCalled();
    expect(harness.loadInstantQuotePage).not.toHaveBeenCalled();
  });

  it("stays off when the Connect account is not ready", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const result = await startInstantQuoteDeposit("acme", "lead-1", draft);
    expect(result).toEqual({ ok: false, reason: "not_connected" });
    expect(harness.sessionsCreate).not.toHaveBeenCalled();
  });

  it("opens Checkout on the ready Connect account for the company deposit", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
    harness.loadInstantQuotePage.mockResolvedValue({
      orgId: "org-1",
      orgName: "Acme",
      slug: "acme",
      services: ["Mowing"],
      consentText: "",
      responseTargetMinutes: 60,
      config: { serviceAreaZips: ["37064"], statedMinimum: 50, depositCents: 2500 },
    });
    harness.connectMaybeSingle.mockResolvedValue({
      data: { stripe_account_id: "acct_connected", status: "ready" },
      error: null,
    });
    harness.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    const result = await startInstantQuoteDeposit("acme", "lead-1", draft);
    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_1", sessionId: "cs_1" });
    const params = harness.sessionsCreate.mock.calls[0]?.[0] as { line_items: { price_data: { unit_amount: number } }[] };
    expect(params.line_items[0]?.price_data.unit_amount).toBe(2500);
    expect(harness.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ success_url: "https://app.example/w/acme?deposit=paid" }),
      { stripeAccount: "acct_connected", idempotencyKey: "lawnquoter_instant_quote_deposit_lead-1" },
    );
  });
});
