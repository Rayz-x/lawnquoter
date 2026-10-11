import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const constructEvent = vi.fn();
  const update = vi.fn();
  const maybeSingle = vi.fn();
  return {
    constructEvent,
    update,
    maybeSingle,
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

import { POST } from "./route";

beforeEach(() => {
  harness.constructEvent.mockReset();
  harness.update.mockReset();
  harness.maybeSingle.mockReset();
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
    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=x" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    expect(harness.update).toHaveBeenCalledWith({
      charges_enabled: true,
      payouts_enabled: true,
      status: "ready",
    });
  });
});
