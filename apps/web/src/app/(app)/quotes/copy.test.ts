import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  status: "draft",
  frozen: false,
  updates: [] as Record<string, unknown>[],
  empty: false,
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({ userId: "user-1", email: null, orgId: "org-1", orgRole: "owner" as const })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const api = {
        select: () => api,
        eq(key: string, value: unknown) {
          filters[key] = value;
          return api;
        },
        update(values: Record<string, unknown>) {
          patch = values;
          return api;
        },
        maybeSingle: () => Promise.resolve(table === "quotes"
          ? { data: { title: "Service quote", intro: null, notes_customer: null, status: db.status, current_version: 1 }, error: null }
          : { data: { frozen: db.frozen }, error: null }),
        then(ok: (value: unknown) => unknown, bad?: (reason: unknown) => unknown) {
          if (patch) db.updates.push(patch);
          return Promise.resolve({ data: db.empty ? [] : [{ id: "quote-1" }], error: null }).then(ok, bad);
        },
      };
      return api;
    },
  })),
}));

import { updateQuoteMeta } from "./actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  db.status = "draft";
  db.frozen = false;
  db.updates = [];
  db.empty = false;
});

describe("updateQuoteMeta", () => {
  it("saves only the fields that card sent", async () => {
    expect(await updateQuoteMeta("quote-1", form({ title: "Spring", intro: "Hello", notes_customer: "Gate code" }))).toEqual({ ok: true });
    expect(db.updates).toEqual([{ title: "Spring", intro: "Hello", notes_customer: "Gate code" }]);
    db.updates = [];
    expect(await updateQuoteMeta("quote-1", form({ notes_internal: "Crew note" }))).toEqual({ ok: true });
    expect(db.updates).toEqual([{ notes_internal: "Crew note" }]);
  });

  it("reports a save that updates no rows", async () => {
    db.empty = true;
    expect(await updateQuoteMeta("quote-1", form({ notes_internal: "Crew note" }))).toEqual({
      ok: false,
      error: "Could not save this change.",
    });
  });
});
