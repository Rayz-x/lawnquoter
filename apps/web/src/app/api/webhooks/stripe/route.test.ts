import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const constructEvent = vi.fn();
  const update = vi.fn();
  const maybeSingle = vi.fn();
  const insertMaybeSingle = vi.fn();
  const insertSingle = vi.fn();
  const selectMaybeSingle = vi.fn();
  const paymentsUpdate = vi.fn();
  const invoicesUpdate = vi.fn();
  const retrieve = vi.fn();
  const membershipsSelect = vi.fn();
  const orgsMaybeSingle = vi.fn();
  return {
    constructEvent,
    update,
    maybeSingle,
    insertMaybeSingle,
    insertSingle,
    selectMaybeSingle,
    paymentsUpdate,
    invoicesUpdate,
    retrieve,
    membershipsSelect,
    orgsMaybeSingle,
    eq: vi.fn(() => ({ select: () => ({ maybeSingle: harness.maybeSingle }) })),
  };
});

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: harness.constructEvent },
    paymentIntents: { retrieve: harness.retrieve },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "org_stripe_connect") {
        return {
          update: (patch: unknown) => {
            harness.update(patch);
            return { eq: harness.eq };
          },
        };
      }
      if (table === "stripe_events") {
        return {
          insert: () => ({
            select: () => ({
              maybeSingle: harness.insertMaybeSingle,
            }),
          }),
        };
      }
      if (table === "invoices") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: harness.selectMaybeSingle,
            }),
          }),
          update: (patch: unknown) => {
            harness.invoicesUpdate(patch);
            const chain: {
              eq: () => typeof chain;
              then: (resolve: (value: { error: null }) => unknown) => unknown;
            } = {
              eq: () => chain,
              then: (resolve) => resolve({ error: null }),
            };
            return chain;
          },
        };
      }
      if (table === "payments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: harness.insertSingle,
            }),
          }),
          update: (patch: unknown) => {
            harness.paymentsUpdate(patch);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "orgs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: harness.orgsMaybeSingle,
            }),
          }),
        };
      }
      if (table === "memberships") {
        return {
          select: () => ({
            eq: () => ({
              in: harness.membershipsSelect,
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  for (const fn of Object.values(harness)) {
    if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
  }
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  harness.maybeSingle.mockResolvedValue({ data: { org_id: "org-1" }, error: null });
  harness.insertMaybeSingle.mockResolvedValue({ data: { id: "se-1" }, error: null });
  harness.insertSingle.mockResolvedValue({ data: { id: "pay-1" }, error: null });
  harness.selectMaybeSingle.mockResolvedValue({
    data: {
      id: "inv-1",
      org_id: "org-1",
      account_id: "acct-1",
      status: "issued",
      total_cents: 12500,
      currency: "usd",
      number: 42,
    },
    error: null,
  });
  harness.retrieve.mockResolvedValue({
    payment_method: { type: "card", card: { brand: "visa", last4: "4242" } },
  });
  harness.orgsMaybeSingle.mockResolvedValue({ data: { name: "Prairie", email: "office@x.com" }, error: null });
  harness.membershipsSelect.mockResolvedValue({ data: [], error: null });
  harness.eq.mockImplementation(() => ({ select: () => ({ maybeSingle: harness.maybeSingle }) }));
});

function signedRequest(body = "{}") {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=x" },
    body,
  });
}

describe("POST /api/webhooks/stripe", () => {
  it("rejects missing signatures with 400 and does not write", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(400);
    expect(harness.constructEvent).not.toHaveBeenCalled();
    expect(harness.insertMaybeSingle).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures with 400 and does not write", async () => {
    harness.constructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const response = await POST(signedRequest());
    expect(response.status).toBe(400);
    expect(harness.insertMaybeSingle).not.toHaveBeenCalled();
  });

  it("account.updated flips status to ready when charges and payouts are enabled", async () => {
    harness.constructEvent.mockReturnValue({
      type: "account.updated",
      data: { object: { id: "acct_1", charges_enabled: true, payouts_enabled: true } },
    });
    const response = await POST(signedRequest());
    expect(response.status).toBe(200);
    expect(harness.update).toHaveBeenCalledWith({
      charges_enabled: true,
      payouts_enabled: true,
      status: "ready",
    });
  });

  it("card checkout.session.completed records one succeeded payment and marks paid", async () => {
    harness.constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      account: "acct_connected",
      data: {
        object: {
          id: "cs_1",
          object: "checkout.session",
          payment_status: "paid",
          amount_total: 12500,
          currency: "usd",
          payment_intent: "pi_1",
          metadata: {
            lawnquoter_invoice_id: "inv-1",
            lawnquoter_org_id: "org-1",
            lawnquoter_account_id: "acct-1",
          },
        },
      },
    });
    const response = await POST(signedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "paid" });
    expect(harness.insertSingle).toHaveBeenCalled();
    expect(harness.invoicesUpdate).toHaveBeenCalledWith({
      status: "paid",
      paid_at: expect.any(String),
    });
  });

  it("replayed events are a no-op with no second payment write", async () => {
    harness.insertMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    harness.constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          object: "checkout.session",
          payment_status: "paid",
          amount_total: 12500,
          currency: "usd",
          payment_intent: "pi_1",
          metadata: {
            lawnquoter_invoice_id: "inv-1",
            lawnquoter_org_id: "org-1",
            lawnquoter_account_id: "acct-1",
          },
        },
      },
    });
    const response = await POST(signedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "duplicate" });
    expect(harness.insertSingle).not.toHaveBeenCalled();
    expect(harness.invoicesUpdate).not.toHaveBeenCalled();
  });

  it("ACH processing records processing without marking the invoice paid", async () => {
    harness.retrieve.mockResolvedValue({
      payment_method: {
        type: "us_bank_account",
        us_bank_account: { bank_name: "stripe_test", last4: "6789" },
      },
    });
    harness.constructEvent.mockReturnValue({
      id: "evt_proc",
      type: "payment_intent.processing",
      account: "acct_connected",
      data: {
        object: {
          id: "pi_ach",
          object: "payment_intent",
          status: "processing",
          amount: 12500,
          currency: "usd",
          metadata: {
            lawnquoter_invoice_id: "inv-1",
            lawnquoter_org_id: "org-1",
            lawnquoter_account_id: "acct-1",
          },
        },
      },
    });
    const response = await POST(signedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "processing" });
    expect(harness.invoicesUpdate).not.toHaveBeenCalled();
  });
});
