import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const requireOrg = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireOrg }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from })) }));

import { saveOnboarding } from "./actions";

const owner = { userId: "user-1", email: null, orgId: "org-1", orgRole: "owner" as const };

beforeEach(() => {
  from.mockReset();
  requireOrg.mockResolvedValue(owner);
});

describe("saveOnboarding", () => {
  it("stores the brand color, the next step, and the service-area ZIPs", async () => {
    const saved = vi.fn(async () => ({ data: { id: "org-1" }, error: null }));
    const update = vi.fn(() => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: saved }) }) }) }));
    from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: { settings: { week_start: "monday" }, updated_at: "t1" }, error: null }) }) }),
      update,
    });
    expect(await saveOnboarding({ step: "services", brandColor: "#1e5235", serviceArea: "37064, 37067" })).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      brand_color: "#1E5235",
      settings: { week_start: "monday", onboarding_step: "services", lead_service_area_zips: ["37064", "37067"] },
    });
  });

  it("rejects a color that is not hex", async () => {
    expect(await saveOnboarding({ brandColor: "green" })).toEqual({ ok: false, error: "Enter a hex color like #1E5235." });
    expect(from).not.toHaveBeenCalled();
  });
});
