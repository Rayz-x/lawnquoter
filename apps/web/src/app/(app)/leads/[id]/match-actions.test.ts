import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner" as string,
  lead: { id: "11111111-1111-4111-8111-111111111111", account_id: null as string | null },
  account: { id: "22222222-2222-4222-8222-222222222222", name: "Jane Doe" },
  updates: [] as Record<string, unknown>[],
  activities: [] as Record<string, unknown>[],
}));

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
  createClient: vi.fn(async () => ({
    from(table: string) {
      return makeQuery(table);
    },
  })),
}));

function makeQuery(table: string) {
  const filters: Record<string, unknown> = {};
  let patch: Record<string, unknown> | null = null;
  let insertRow: Record<string, unknown> | null = null;
  let mode: "select" | "update" | "insert" = "select";

  const api = {
    select() {
      return api;
    },
    eq(key: string, value: unknown) {
      filters[key] = value;
      return api;
    },
    update(values: Record<string, unknown>) {
      mode = "update";
      patch = values;
      return api;
    },
    insert(values: Record<string, unknown>) {
      mode = "insert";
      insertRow = values;
      return api;
    },
    maybeSingle: async () => {
      if (table === "accounts") {
        if (filters.id === state.account.id) return { data: state.account, error: null };
        return { data: null, error: null };
      }
      if (table === "lead_requests") {
        if (filters.id === state.lead.id) return { data: state.lead, error: null };
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    single: async () => api.maybeSingle(),
    then(
      onfulfilled?: (value: { data: unknown; error: null }) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) {
      try {
        if (mode === "update" && patch) {
          state.updates.push(patch);
          state.lead = { ...state.lead, ...(patch as { account_id: string | null }) };
          return Promise.resolve(onfulfilled?.({ data: [{ id: state.lead.id }], error: null }));
        }
        if (mode === "insert" && insertRow) {
          state.activities.push(insertRow);
          return Promise.resolve(onfulfilled?.({ data: null, error: null }));
        }
        return Promise.resolve(onfulfilled?.({ data: null, error: null }));
      } catch (error) {
        return Promise.reject(onrejected?.(error));
      }
    },
  };

  return api;
}

import { dismissPossibleMatch, linkLeadToAccount } from "./match-actions";

describe("linkLeadToAccount", () => {
  beforeEach(() => {
    state.role = "owner";
    state.lead = { id: "11111111-1111-4111-8111-111111111111", account_id: null };
    state.updates = [];
    state.activities = [];
  });

  it("attaches the account from the possible-match banner", async () => {
    const result = await linkLeadToAccount(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(result).toEqual({ ok: true });
    expect(state.updates).toEqual([{ account_id: "22222222-2222-4222-8222-222222222222" }]);
    expect(state.lead.account_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(state.activities[0]).toMatchObject({
      kind: "lead.match_linked",
      meta: { account_id: "22222222-2222-4222-8222-222222222222" },
    });
  });

  it("records create-new dismiss without linking", async () => {
    const result = await dismissPossibleMatch(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(result).toEqual({ ok: true });
    expect(state.updates).toEqual([]);
    expect(state.activities[0]).toMatchObject({
      kind: "lead.match_dismissed",
      meta: { account_id: "22222222-2222-4222-8222-222222222222" },
    });
  });
});
