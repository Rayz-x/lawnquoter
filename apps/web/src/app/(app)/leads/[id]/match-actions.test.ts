import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner" as string,
  leadExists: true,
  account: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Jane" } as {
    id: string;
    name: string;
  } | null,
  property: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } as { id: string } | null,
  updated: true,
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

function makeApi(table: string) {
  const api = {
    select: () => api,
    eq: () => api,
    update: () => api,
    insert: (row: Record<string, unknown>) => {
      state.activities.push(row);
      return api;
    },
    maybeSingle: async () => {
      if (table === "accounts") return { data: state.account, error: null };
      if (table === "properties") return { data: state.property, error: null };
      if (table === "lead_requests") {
        return { data: state.leadExists ? { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } : null, error: null };
      }
      return { data: null, error: null };
    },
    then(ok: (v: unknown) => unknown, err?: (v: unknown) => unknown) {
      if (table === "lead_requests") {
        return Promise.resolve({
          data: state.updated ? [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] : [],
          error: null,
        }).then(ok, err);
      }
      return Promise.resolve({ data: null, error: null }).then(ok, err);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => makeApi(table),
  })),
}));

vi.mock("@/lib/leads/client", () => ({
  leadsClient: () => ({
    from: (table: string) => makeApi(table),
  }),
}));

import { dismissLeadMatch, linkLeadMatch } from "./actions";

describe("linkLeadMatch", () => {
  beforeEach(() => {
    state.role = "owner";
    state.leadExists = true;
    state.account = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Jane" };
    state.property = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    state.updated = true;
    state.activities = [];
  });

  it("attaches account and property from the banner Link action", async () => {
    const result = await linkLeadMatch(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(result).toEqual({ ok: true });
    expect(state.activities.some((row) => row.kind === "match_linked")).toBe(true);
  });

  it("records Create new as a dismissal without linking", async () => {
    const result = await dismissLeadMatch(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(result).toEqual({ ok: true });
    expect(state.activities.some((row) => row.kind === "match_dismissed")).toBe(true);
  });
});
