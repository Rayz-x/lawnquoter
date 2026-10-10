import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const requireOrg = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireOrg }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from })) }));

import { saveRule, toggleService } from "./actions";

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
});
