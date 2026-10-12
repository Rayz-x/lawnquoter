import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const requireOrg = vi.fn();
  const adminFrom = vi.fn();
  return { requireOrg, adminFrom };
});

vi.mock("@/lib/auth/session", () => ({ requireOrg: () => harness.requireOrg() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: vi.fn() }),
  createAdminClient: () => ({ from: harness.adminFrom }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { syncQuickBooksLedger } from "./actions";

beforeEach(() => {
  harness.requireOrg.mockReset();
  harness.adminFrom.mockReset();
  delete process.env.QBO_CLIENT_ID;
  delete process.env.QBO_CLIENT_SECRET;
  harness.requireOrg.mockResolvedValue({ orgId: "org-1", orgRole: "owner", userId: "u1", email: "o@x.com" });
});

describe("syncQuickBooksLedger", () => {
  it("stays off until the QuickBooks keys are set", async () => {
    expect(await syncQuickBooksLedger()).toEqual({ ok: false, error: "Not connected - add a QuickBooks key to enable." });
    expect(harness.adminFrom).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not an owner or admin", async () => {
    process.env.QBO_CLIENT_ID = "id";
    process.env.QBO_CLIENT_SECRET = "secret";
    harness.requireOrg.mockResolvedValue({ orgId: "org-1", orgRole: "crew", userId: "u1", email: "c@x.com" });
    expect(await syncQuickBooksLedger()).toEqual({ ok: false, error: "Only owners and admins can sync QuickBooks." });
    expect(harness.adminFrom).not.toHaveBeenCalled();
  });

  it("asks the owner to connect before invoices can sync", async () => {
    process.env.QBO_CLIENT_ID = "id";
    process.env.QBO_CLIENT_SECRET = "secret";
    harness.adminFrom.mockImplementation((table: string) => {
      const result = table === "qbo_connections" ? { realm_id: "999" } : null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: result, error: null }),
      };
      return builder;
    });
    expect(await syncQuickBooksLedger()).toEqual({ ok: false, error: "Connect QuickBooks before invoices can sync." });
  });
});
