import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => nav.redirect(url),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({
    userId: "user-1",
    email: null,
    orgId: "org-1",
    orgRole: "owner" as const,
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));
vi.mock("@/lib/geo/parcel", () => ({
  lookupParcel: vi.fn(async () => null),
}));
vi.mock("@/lib/geo/footprint", () => ({
  lookupFootprint: vi.fn(async () => null),
}));

import { convertLeadAndOpenMeasurement } from "./convert-actions";

beforeEach(() => {
  rpc.mockReset();
  nav.redirect.mockClear();
});

describe("convertLeadAndOpenMeasurement", () => {
  it("returns RPC errors without redirecting", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "lead not found" } });

    const result = await convertLeadAndOpenMeasurement("lead-1");

    expect(result).toEqual({ ok: false, error: "lead not found" });
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("opens measurement with suggested-line convert result", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "convert_lead_request") {
        return {
          data: {
            account_id: "acct-1",
            property_id: "prop-1",
            quote_id: "quote-1",
            measurement_path: "/properties/prop-1/measure",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    await expect(convertLeadAndOpenMeasurement("lead-1")).rejects.toThrow(
      "REDIRECT:/properties/prop-1/measure",
    );
    expect(rpc).toHaveBeenCalledWith("convert_lead_request", {
      p_lead: "lead-1",
      p_account: undefined,
      p_force_fail: false,
    });
  });
});
