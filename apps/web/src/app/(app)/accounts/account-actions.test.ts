import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const query = {
    eq() { return query; },
    select() { return query; },
    then(ok: (v: unknown) => unknown, err?: (v: unknown) => unknown) {
      return Promise.resolve({ data: state.rows, error: null }).then(ok, err);
    },
  };
  return { role: "owner", rows: [{ id: "acct-1" }] as { id: string }[], query };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/geo/resolve", () => ({ resolvePropertyGeo: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({ userId: "user-1", email: null, orgId: "org-1", orgRole: state.role })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: () => ({ update: () => state.query }) })),
}));
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
  it("blocks dispatcher, read-only, and crew, and fails on zero rows", async () => {
    for (const role of ["dispatcher", "read_only", "crew"]) {
      state.role = role;
      expect(await updateAccount("acct-1", form())).toEqual({ ok: false, error: "You don't have permission to edit customers." });
    }
    state.role = "owner";
    state.rows = [];
    expect((await updateAccount("acct-1", form())).ok).toBe(false);
  });
});
