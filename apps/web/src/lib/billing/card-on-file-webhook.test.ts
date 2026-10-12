import { describe, expect, it } from "vitest";
import { applyCardSetupEvent } from "./card-on-file-webhook";
import type { CardSetupSession } from "./card-on-file";

const session: CardSetupSession = {
  mode: "setup",
  customer: { id: "cus_123" },
  metadata: {
    lawnquoter_org_id: "org-1",
    lawnquoter_account_id: "acct-1",
    lawnquoter_purpose: "card_on_file",
  },
  setup_intent: {
    id: "seti_1",
    payment_method: {
      id: "pm_visa",
      type: "card",
      card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029 },
    },
  },
};

describe("applyCardSetupEvent", () => {
  it("saves the first card as the default", async () => {
    const saved: unknown[] = [];
    const outcome = await applyCardSetupEvent({
      eventId: "evt_1",
      session,
      store: {
        claimEvent: async () => ({ claimed: true }),
        hasCard: async () => false,
        saveCard: async (input) => {
          saved.push(input);
        },
      },
    });
    expect(outcome).toBe("saved");
    expect(saved).toEqual([
      {
        orgId: "org-1",
        accountId: "acct-1",
        makeDefault: true,
        card: {
          stripeCustomerId: "cus_123",
          stripePaymentMethodId: "pm_visa",
          kind: "card",
          brand: "visa",
          last4: "4242",
          expMonth: 4,
          expYear: 2029,
        },
      },
    ]);
  });

  it("does not save a duplicate Stripe event", async () => {
    const outcome = await applyCardSetupEvent({
      eventId: "evt_1",
      session,
      store: {
        claimEvent: async () => ({ claimed: false }),
        hasCard: async () => {
          throw new Error("should not look up cards");
        },
        saveCard: async () => {
          throw new Error("should not save");
        },
      },
    });
    expect(outcome).toBe("duplicate");
  });
});
