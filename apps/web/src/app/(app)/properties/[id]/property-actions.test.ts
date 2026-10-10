import { describe, expect, it, vi } from "vitest";

const { requireOrg } = vi.hoisted(() => ({
  requireOrg: vi.fn(async () => ({ userId: "user-1", email: null, orgId: "org-1", orgRole: "crew" as const })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireOrg }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: () => { throw new Error("crew should not query"); } })),
}));

import { updatePropertyConditions, updatePropertyMeta } from "./actions";

describe("property actions", () => {
  it("blocks crew before a property write", async () => {
    const result = await updatePropertyConditions("prop-1", { slope: "flat", gate_width_in: 36, obstacle_count: 0, has_stairs: false });
    expect(result).toEqual({ ok: false, error: "You don't have permission to edit properties." });
    expect(await updatePropertyMeta("prop-1", { name: "Side" })).toEqual({ ok: false, error: "You don't have permission to edit properties." });
  });
});
