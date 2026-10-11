import { beforeEach, describe, expect, it, vi } from "vitest";

const QUOTE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

const rpc = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({
    userId: "user-1",
    email: null,
    orgId: "org-1",
    orgRole: "owner" as const,
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc,
  })),
}));

import { reviseQuote } from "./actions";

beforeEach(() => {
  rpc.mockReset();
});

describe("reviseQuote", () => {
  it("starts a revision through quote_revise", async () => {
    rpc.mockResolvedValueOnce({ data: VERSION_ID, error: null });

    const result = await reviseQuote(QUOTE_ID);

    expect(rpc).toHaveBeenCalledWith("quote_revise", { p_quote: QUOTE_ID });
    expect(result).toEqual({ ok: true, data: { versionId: VERSION_ID } });
  });

  it("surfaces the RPC error when revise fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "accepted quotes are final" } });

    const result = await reviseQuote(QUOTE_ID);

    expect(result).toEqual({ ok: false, error: "accepted quotes are final" });
  });
});
