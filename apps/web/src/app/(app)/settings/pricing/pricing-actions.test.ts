import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const requireOrg = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireOrg }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from })) }));

import { defaultModifiers } from "@lawnquoter/pricing-engine";
import { raiseAllPrices, saveModifiers, saveRule, toggleService } from "./actions";
import { modifiersToFields } from "./modifier-fields";

const owner = { userId: "user-1", email: null, orgId: "org-1", orgRole: "owner" as const };

beforeEach(() => {
  from.mockReset();
  requireOrg.mockResolvedValue(owner);
});

describe("pricing actions", () => {
  it("blocks non-admins", async () => {
    requireOrg.mockResolvedValueOnce({ ...owner, orgRole: "sales" });
    expect(await toggleService("svc-1", false)).toEqual({ ok: false, error: "Only an owner or admin can change pricing." });
  });
  it("fails when an update changes zero rows", async () => {
    const select = vi.fn(async () => ({ data: [], error: null }));
    from.mockReturnValue({ update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ select })) })) })) });
    const fd = new FormData();
    fd.set("id", "11111111-1111-4111-8111-111111111111");
    fd.set("service_id", "22222222-2222-4222-8222-222222222222");
    fd.set("price_list_id", "33333333-3333-4333-8333-333333333333");
    fd.set("name", "Tiers");
    fd.set("config", JSON.stringify({ type: "tier_matrix", quantityKey: "turf_sqft", rows: [{ upTo: null, price: 40, hours: 0.5, cost: 18 }] }));
    expect(await saveRule(fd)).toEqual({ ok: false, error: "Nothing was saved. You may not have permission to change pricing." });
  });
  it("saves plain modifier fields as engine modifiers and rejects bad values", async () => {
    const select = vi.fn(async () => ({ data: [{ id: "l" }], error: null }));
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ select })) })) }));
    from.mockReturnValue({ update });
    const list = "33333333-3333-4333-8333-333333333333";
    const fields = { ...modifiersToFields(defaultModifiers()), firstCutPct: 25 };
    expect(await saveModifiers(list, fields)).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ modifiers: expect.objectContaining({ firstCut: { multiplier: 1.25 } }) });
    expect((await saveModifiers(list, { ...fields, minimumPrice: -5 })).ok).toBe(false);
    expect((await saveModifiers(list, "{\"minimum\":1}")).ok).toBe(false);
  });

  it("raises every dollar on the price list and leaves hours alone", async () => {
    const saved = vi.fn(async () => ({ data: [{ id: "r1" }], error: null }));
    const ruleUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ select: saved })) })) }));
    const listUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ select: saved })) })) }));
    from.mockImplementation((table: string) => {
      if (table === "price_lists") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { modifiers: { minimum: { price: 45, hours: 0.4 } } }, error: null }),
              }),
            }),
          }),
          update: listUpdate,
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({
              data: [
                {
                  id: "r1",
                  config: {
                    type: "tier_matrix",
                    quantityKey: "turf_sqft",
                    rows: [{ upTo: 5000, price: 40, hours: 0.5, cost: 18 }],
                  },
                },
              ],
              error: null,
            }),
          }),
        }),
        update: ruleUpdate,
      };
    });
    const list = "33333333-3333-4333-8333-333333333333";
    expect(await raiseAllPrices(list, 10)).toEqual({ ok: true, data: { count: 1 } });
    expect(ruleUpdate).toHaveBeenCalledWith({
      rule_type: "tier_matrix",
      config: expect.objectContaining({
        rows: [expect.objectContaining({ price: 44, hours: 0.5, cost: 19.8 })],
      }),
    });
    expect(listUpdate).toHaveBeenCalledWith({
      modifiers: expect.objectContaining({
        minimum: expect.objectContaining({ price: 49.5, hours: 0.4 }),
        narrowGate: expect.objectContaining({ extraPrice: 8.8, extraHours: 0.15 }),
      }),
    });
    expect(await raiseAllPrices(list, 0)).toEqual({ ok: false, error: "Enter a percent from -50 to 100, other than zero." });
    expect(await raiseAllPrices(list, 150)).toEqual({ ok: false, error: "Enter a percent from -50 to 100, other than zero." });
  });

  it("does not change prices when one rule cannot be read", async () => {
    const update = vi.fn();
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [{ id: "r1", config: { type: "nope" } }], error: null }),
        }),
      }),
      update,
    });
    const result = await raiseAllPrices("33333333-3333-4333-8333-333333333333", 10);
    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
