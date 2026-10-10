import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "owner", rows: [{ id: "acct-1" }] as { id: string }[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/geo/resolve", () => ({ resolvePropertyGeo: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({ userId: "user-1", email: null, orgId: "org-1", orgRole: state.role })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      update: () => query,
      eq: () => query,
      select: () => query,
      then: (ok: (v: unknown) => unknown, err?: (v: unknown) => unknown) =>
        Promise.resolve({ data: state.rows, error: null }).then(ok, err),
    }),
  })),
}));

const query = {
  eq() {
    return query;
  },
  select() {
    return query;
  },
  then(ok: (v: unknown) => unknown, err?: (v: unknown) => unknown) {
    return Promise.resolve({ data: state.rows, error: null }).then(ok, err);
  },
};

import { updateAccount } from "./actions";

function form() {
  const fd = new FormData();
  fd.set("name", "Ada Lovelace");
  fd.set("type", "residential");
  fd.set("email", "ada@example.com");
  return fd;
}

beforeEach(() => {
  state.role = "owner";
  state.rows = [{ id: "acct-1" }];
});

describe("updateAccount", () => {
  it("blocks dispatcher, read-only, and crew", async () => {
    for (const role of ["dispatcher", "read_only", "crew"]) {
      state.role = role;
      const result = await updateAccount("acct-1", form());
      expect(result).toEqual({ ok: false, error: "You don't have permission to edit customers." });
    }
  });

  it("fails when the update changes zero rows", async () => {
    state.rows = [];
    const result = await updateAccount("acct-1", form());
    expect(result.ok).toBe(false);
  });
});
