import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const constructEvent = vi.fn();
  const update = vi.fn();
  const maybeSingle = vi.fn();
  const applyRefundDispute = vi.fn();
  return {
    constructEvent,
    update,
    maybeSingle,
    applyRefundDispute,
    eq: vi.fn(() => ({ select: () => ({ maybeSingle: harness.maybeSingle }) })),
  };
});

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ webhooks: { constructEvent: harness.constructEvent } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (patch: unknown) => {
        harness.update(patch);
        return { eq: harness.eq };
      },
    }),
  }),
}));
vi.mock("@/lib/billing/supabase-stripe-refund-dispute-store", () => ({
  createStripeRefundDisputeStore: () => ({ mocked: true }),
}));
vi.mock("@/lib/billing/stripe-refund-dispute-webhook", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/stripe-refund-dispute-webhook")>(
    "@/lib/billing/stripe-refund-dispute-webhook",
  );
  return {
    ...actual,
    applyStripeRefundDisputeEvent: harness.applyRefundDispute,
  };
});

import { POST } from "./route";

function signedRequest() {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=x" },
    body: "{}",
  });
}

beforeEach(() => {
  harness.constructEvent.mockReset();
  harness.update.mockReset();
  harness.maybeSingle.mockReset();
  harness.applyRefundDispute.mockReset();
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  harness.maybeSingle.mockResolvedValue({ data: { org_id: "org-1" }, error: null });
});

describe("POST /api/webhooks/stripe", () => {
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

  it("charge.refunded records a refund once via the refund/dispute handler", async () => {
    harness.applyRefundDispute.mockResolvedValue({ ok: true, outcome: "refunded" });
    harness.constructEvent.mockReturnValue({
      id: "evt_refund_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_1",
          object: "charge",
          payment_intent: "pi_1",
          amount_refunded: 12500,
          refunds: { data: [{ id: "re_1", amount: 12500 }] },
        },
      },
    });
    const response = await POST(signedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "refunded" });
    expect(harness.applyRefundDispute).toHaveBeenCalledTimes(1);
  });

  it("charge.dispute.created flags and charge.dispute.closed clears", async () => {
    harness.applyRefundDispute
      .mockResolvedValueOnce({ ok: true, outcome: "dispute_flagged" })
      .mockResolvedValueOnce({ ok: true, outcome: "dispute_cleared" });

    harness.constructEvent.mockReturnValue({
      id: "evt_dispute_1",
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_1",
          object: "dispute",
          charge: "ch_1",
          evidence_details: { due_by: 1_760_000_000 },
        },
      },
    });
    const created = await POST(signedRequest());
    expect(await created.json()).toEqual({ received: true, outcome: "dispute_flagged" });

    harness.constructEvent.mockReturnValue({
      id: "evt_dispute_2",
      type: "charge.dispute.closed",
      data: {
        object: {
          id: "dp_1",
          object: "dispute",
          charge: "ch_1",
          status: "won",
        },
      },
    });
    const closed = await POST(signedRequest());
    expect(await closed.json()).toEqual({ received: true, outcome: "dispute_cleared" });
    expect(harness.applyRefundDispute).toHaveBeenCalledTimes(2);
  });
});
