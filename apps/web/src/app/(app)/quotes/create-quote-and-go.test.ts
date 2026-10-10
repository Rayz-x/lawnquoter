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

import { createQuoteAndGo } from "./actions";

beforeEach(() => {
  rpc.mockReset();
  nav.redirect.mockClear();
});

describe("createQuoteAndGo", () => {
  it("returns the create error instead of redirecting back to the account", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "quote create failed" } });

    const result = await createQuoteAndGo("acct-1", null);

    expect(result).toEqual({ ok: false, error: "quote create failed" });
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("still opens the new quote when create succeeds", async () => {
    rpc.mockResolvedValue({ data: "quote-1", error: null });

    await expect(createQuoteAndGo("acct-1", "prop-1")).rejects.toThrow("REDIRECT:/quotes/quote-1");
  });
});
