import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const loadInstantQuotePage = vi.fn();
  const verifyTurnstileToken = vi.fn();
  const countRecentByIpHash = vi.fn();
  const countRecentByOrg = vi.fn();
  const insert = vi.fn();
  return { loadInstantQuotePage, verifyTurnstileToken, countRecentByIpHash, countRecentByOrg, insert };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.4" }) }));
vi.mock("@/lib/leads/load-public-form", () => ({ loadInstantQuotePage: harness.loadInstantQuotePage }));
vi.mock("@/lib/leads/turnstile", () => ({ verifyTurnstileToken: harness.verifyTurnstileToken }));
vi.mock("@/lib/leads/intake-store", () => ({
  createLeadIntakeStore: () => ({
    countRecentByIpHash: harness.countRecentByIpHash,
    countRecentByOrg: harness.countRecentByOrg,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "price_lists") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { id: "list-1", modifiers: {} } }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "pricing_rules") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{
                    name: "Mowing",
                    config: {
                      type: "tier_matrix",
                      quantityKey: "turf_sqft",
                      rows: [{ upTo: 10000, price: 55, hours: 0, cost: 0 }],
                    },
                  }],
                }),
              }),
            }),
          }),
        };
      }
      return {
        insert: (row: unknown) => {
          harness.insert(row);
          const saved = Promise.resolve({ error: null });
          return Object.assign(saved, {
            select: () => ({ single: async () => ({ data: { id: "lead-1" }, error: null }) }),
          });
        },
      };
    },
  }),
}));

import { emptyInstantQuote } from "@/lib/leads/instant-quote";
import { revealInstantQuote } from "./reveal-quote";

const draft = {
  ...emptyInstantQuote(),
  address: "1 Oak St",
  postalCode: "37064",
  service: "Mowing",
  hasGate: false,
  hasDogs: false,
  lotSqft: 10000,
  contactName: "Ada",
  email: "ada@example.com",
};

beforeEach(() => {
  harness.loadInstantQuotePage.mockReset();
  harness.verifyTurnstileToken.mockReset();
  harness.countRecentByIpHash.mockReset();
  harness.countRecentByOrg.mockReset();
  harness.insert.mockReset();
  harness.loadInstantQuotePage.mockResolvedValue({
    orgId: "org-1",
    orgName: "Acme",
    slug: "acme",
    services: ["Mowing"],
    consentText: "",
    responseTargetMinutes: 60,
    config: { serviceAreaZips: ["37064"], statedMinimum: 50 },
  });
  harness.verifyTurnstileToken.mockResolvedValue(true);
  harness.countRecentByIpHash.mockResolvedValue(0);
  harness.countRecentByOrg.mockResolvedValue(0);
  harness.insert.mockResolvedValue({ error: null });
});

describe("revealInstantQuote", () => {
  it("does not insert a lead when Turnstile, the honeypot, or the rate limit fails", async () => {
    harness.verifyTurnstileToken.mockResolvedValue(false);
    expect(await revealInstantQuote("acme", draft, { turnstileToken: "bad", honeypot: "" })).toBeNull();
    expect(harness.insert).not.toHaveBeenCalled();

    harness.verifyTurnstileToken.mockResolvedValue(true);
    harness.countRecentByIpHash.mockResolvedValue(5);
    expect(await revealInstantQuote("acme", draft, { turnstileToken: "ok", honeypot: "" })).toBeNull();
    expect(harness.insert).not.toHaveBeenCalled();

    harness.countRecentByIpHash.mockResolvedValue(0);
    expect(await revealInstantQuote("acme", draft, { turnstileToken: "ok", honeypot: "bot" })).toBeNull();
    expect(harness.insert).not.toHaveBeenCalled();
  });

  it("inserts only after the intake guards pass", async () => {
    const offer = await revealInstantQuote("acme", draft, { turnstileToken: "ok", honeypot: "" });
    expect(offer?.low).toBeGreaterThan(0);
    expect(harness.insert).toHaveBeenCalledTimes(1);
    expect(harness.verifyTurnstileToken).toHaveBeenCalledWith("ok", "203.0.113.4");
  });
});
