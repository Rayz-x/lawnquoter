import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Array<Record<string, unknown>> = [];

const state = vi.hoisted(() => {
  const query = {
    eq() {
      return query;
    },
    select() {
      return query;
    },
    update(values: Record<string, unknown>) {
      updates.push(values);
      return query;
    },
    then(ok: (v: unknown) => unknown, err?: (v: unknown) => unknown) {
      return Promise.resolve({ data: [{ id: "acct-1" }], error: null }).then(ok, err);
    },
  };
  return { role: "owner" as string, query };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({
    userId: "user-1",
    email: null,
    orgId: "org-1",
    orgRole: state.role,
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: () => state.query })),
}));

import { updateAccountSales } from "./rail-actions";

beforeEach(() => {
  updates.length = 0;
  state.role = "owner";
});

describe("updateAccountSales lead source", () => {
  it("rejects Other without text", async () => {
    const result = await updateAccountSales("acct-1", {
      lead_source: "Other",
      lead_source_other: "  ",
      tags: "",
    });
    expect(result).toEqual({
      ok: false,
      error: "Describe the lead source when Other is selected.",
    });
    expect(updates).toHaveLength(0);
  });

  it("saves Other with free text and clears other for Google", async () => {
    expect(
      await updateAccountSales("acct-1", {
        lead_source: "Other",
        lead_source_other: "Nextdoor",
        tags: "hoa",
      }),
    ).toEqual({ ok: true });
    expect(updates.at(-1)).toMatchObject({
      lead_source: "Other",
      lead_source_other: "Nextdoor",
      tags: ["hoa"],
    });

    expect(
      await updateAccountSales("acct-1", {
        lead_source: "Google",
        lead_source_other: "leftover",
        tags: "",
      }),
    ).toEqual({ ok: true });
    expect(updates.at(-1)).toMatchObject({
      lead_source: "Google",
      lead_source_other: null,
    });
  });

  it("rejects Website form as a user-set value and preserves tags-only when already Website form", async () => {
    expect(
      await updateAccountSales("acct-1", {
        lead_source: "Website form",
        lead_source_other: "",
        tags: "web",
      }),
    ).toEqual({ ok: true });
    expect(updates.at(-1)).toEqual({ tags: ["web"] });
  });
});
