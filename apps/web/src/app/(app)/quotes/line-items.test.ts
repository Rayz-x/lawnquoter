import { beforeEach, describe, expect, it, vi } from "vitest";

type Line = { id: string; sort: number; version_id: string; org_id: string; quote_id: string; frozen: boolean };

const db = {
  lines: [] as Line[],
  updates: [] as { id: string; patch: Record<string, unknown> }[],
  updateCount: 0,
  emptyWrites: false,
  role: "owner" as "owner" | "read_only",
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({ userId: "user-1", email: null, orgId: "org-1", orgRole: db.role })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => query(),
  })),
}));

function query() {
  const filters: Record<string, unknown> = {};
  let ids: string[] | null = null;
  let patch: Record<string, unknown> | null = null;
  let mode: "select" | "update" = "select";
  const api = {
    select() {
      return api;
    },
    eq(key: string, value: unknown) {
      filters[key] = value;
      return api;
    },
    in(_key: string, values: string[]) {
      ids = values;
      return api;
    },
    order() {
      return api;
    },
    update(values: Record<string, unknown>) {
      mode = "update";
      patch = values;
      return api;
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(finish()).then(onFulfilled, onRejected);
    },
  };

  function matches(row: Line) {
    if (filters.org_id != null && row.org_id !== filters.org_id) return false;
    if (filters.id != null && row.id !== filters.id) return false;
    if (filters.version_id != null && row.version_id !== filters.version_id) return false;
    if (ids && !ids.includes(row.id)) return false;
    return true;
  }

  function present(row: Line) {
    return {
      id: row.id,
      sort: row.sort,
      version_id: row.version_id,
      quote_versions: { quote_id: row.quote_id, frozen: row.frozen },
    };
  }

  function finish() {
    if (mode === "update") {
      db.updateCount += 1;
      db.updates.push({ id: String(filters.id), patch: patch ?? {} });
      if (db.emptyWrites) return { data: [], error: null };
      const row = db.lines.find((line) => line.id === filters.id && line.org_id === filters.org_id);
      if (row && patch) Object.assign(row, patch);
      return { data: [{ id: filters.id }], error: null };
    }
    const rows = db.lines.filter(matches).map(present).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
    return { data: rows, error: null };
  }

  return api;
}

import { reorderLineItems } from "./actions";

function line(overrides: Partial<Line> = {}): Line {
  return { id: "line-a", sort: 0, version_id: "version-1", org_id: "org-1", quote_id: "quote-1", frozen: false, ...overrides };
}

beforeEach(() => {
  db.lines = [line(), line({ id: "line-b", sort: 1 })];
  db.updates = [];
  db.updateCount = 0;
  db.emptyWrites = false;
  db.role = "owner";
});

describe("reorderLineItems", () => {
  it("writes both positions", async () => {
    const result = await reorderLineItems("quote-1", "line-a", "line-b");
    expect(result).toEqual({ ok: true });
    expect(db.lines.map((row) => [row.id, row.sort])).toEqual([
      ["line-a", 1],
      ["line-b", 0],
    ]);
  });

  it("separates lines that share a sort value", async () => {
    db.lines = [line({ sort: 0 }), line({ id: "line-b", sort: 0 })];
    const result = await reorderLineItems("quote-1", "line-a", "line-b");
    expect(result).toEqual({ ok: true });
    expect(db.lines.find((row) => row.id === "line-a")?.sort).toBe(1);
    expect(db.lines.find((row) => row.id === "line-b")?.sort).toBe(0);
  });

  it("returns an error when the write matches no rows", async () => {
    db.emptyWrites = true;
    const result = await reorderLineItems("quote-1", "line-a", "line-b");
    expect(result).toEqual({ ok: false, error: "Could not save this change." });
  });

  it("rejects a read-only role", async () => {
    db.role = "read_only";
    const result = await reorderLineItems("quote-1", "line-a", "line-b");
    expect(result).toEqual({ ok: false, error: "You do not have access to edit quotes." });
    expect(db.updates).toEqual([]);
  });
});
