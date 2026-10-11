import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const invoiceMaybeSingle = vi.fn();
  const connectMaybeSingle = vi.fn();
  const sessionsCreate = vi.fn();
  return { invoiceMaybeSingle, connectMaybeSingle, sessionsCreate };
});

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "invoices") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: harness.invoiceMaybeSingle }),
          }),
        };
      }
      if (table === "org_stripe_connect") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: harness.connectMaybeSingle }),
          }),
        };
      }
      return {};
    },
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    checkout: { sessions: { create: harness.sessionsCreate } },
  }),
}));

import { POST } from "./route";

const TOKEN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  harness.invoiceMaybeSingle.mockReset();
  harness.connectMaybeSingle.mockReset();
  harness.sessionsCreate.mockReset();
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  harness.invoiceMaybeSingle.mockResolvedValue({
    data: {
      id: "inv-1",
      org_id: "org-1",
      account_id: "acct-1",
      number: 7,
      number_label: "INV-2026-0007",
      status: "issued",
      currency: "usd",
      total_cents: 5000,
      public_token: TOKEN,
    },
    error: null,
  });
  harness.connectMaybeSingle.mockResolvedValue({
    data: { stripe_account_id: "acct_connected", status: "ready" },
    error: null,
  });
  harness.sessionsCreate.mockResolvedValue({
    id: "cs_1",
    url: "https://checkout.stripe.com/c/pay/cs_1",
  });
});

describe("POST /api/i/[token]/checkout", () => {
  it("returns a Stripe Checkout URL on the connected account", async () => {
    const response = await POST(new Request("http://localhost/api/i/x/checkout", { method: "POST" }), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_1",
      sessionId: "cs_1",
    });
    expect(harness.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method_types: ["card", "us_bank_account"],
        success_url: `https://app.example/i/${TOKEN}?paid=1`,
      }),
      expect.objectContaining({
        stripeAccount: "acct_connected",
        idempotencyKey: "lawnquoter_invoice_checkout_inv-1",
      }),
    );
  });

  it("returns 404 when the public token is unknown", async () => {
    harness.invoiceMaybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await POST(new Request("http://localhost/api/i/x/checkout", { method: "POST" }), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(response.status).toBe(404);
    expect(harness.sessionsCreate).not.toHaveBeenCalled();
  });
});
