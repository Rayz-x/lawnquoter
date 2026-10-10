import { beforeEach, describe, expect, it, vi } from "vitest";

const QUOTE_ID = "22222222-2222-4222-8222-222222222222";
const LINE_ID = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;

const db = {
  lines: [] as Row[],
  quotes: [] as Row[],
  versions: [] as Row[],
  updates: [] as { table: string; id: string; patch: Record<string, unknown> }[],
  role: "owner" as "owner" | "read_only",
};

function query(table: string) {
  const filters: Record<string, unknown> = {};
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
    update(values: Record<string, unknown>) {
      mode = "update";
      patch = values;
      return api;
    },
    maybeSingle() {
      const rows =
        table === "quote_line_items"
          ? db.lines
          : table === "quotes"
            ? db.quotes
            : table === "quote_versions"
              ? db.versions
              : [];
      const matched = rows.find((row) =>
        Object.entries(filters).every(([key, value]) => row[key] === value),
      );
      if (!matched) return Promise.resolve({ data: null, error: null });
      if (table === "quote_line_items") {
        return Promise.resolve({
          data: {
            id: matched.id,
            quote_versions: { quote_id: matched.quote_id, frozen: matched.frozen },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: matched, error: null });
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(finish()).then(onFulfilled, onRejected);
    },
  };

  function finish() {
    if (mode === "update") {
      const rows =
        table === "quote_line_items" ? db.lines : table === "quotes" ? db.quotes : db.versions;
      const row = rows.find((item) => item.id === filters.id && item.org_id === filters.org_id);
      if (!row || !patch) return { data: [], error: null };
      Object.assign(row, patch);
      db.updates.push({ table, id: String(filters.id), patch });
      return { data: [{ id: row.id }], error: null };
    }
    return { data: [], error: null };
  }

  return api;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({
    userId: "user-1",
    email: null,
    orgId: "org-1",
    orgRole: db.role,
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => query(table),
  })),
}));

import { updateLineItem, updateQuoteTerms } from "./actions";

beforeEach(() => {
  db.role = "owner";
  db.updates = [];
  db.lines = [
    {
      id: LINE_ID,
      org_id: "org-1",
      quote_id: QUOTE_ID,
      frozen: false,
      price: 40,
      name: "Mow",
      state: "included",
      selected: true,
    },
  ];
  db.quotes = [
    {
      id: QUOTE_ID,
      org_id: "org-1",
      status: "draft",
      current_version: 1,
      deposit_amount: 0,
      expires_at: null,
    },
  ];
  db.versions = [{ id: "v1", org_id: "org-1", quote_id: QUOTE_ID, version: 1, frozen: false }];
});

describe("updateLineItem money", () => {
  it("commits a price on the line", async () => {
    const fd = new FormData();
    fd.set("price", "45");
    const result = await updateLineItem(QUOTE_ID, LINE_ID, fd);
    expect(result).toEqual({ ok: true });
    expect(db.lines[0]?.price).toBe(45);
    expect(db.updates.some((row) => row.patch.price === 45)).toBe(true);
  });

  it("rejects a frozen proposal", async () => {
    db.lines[0]!.frozen = true;
    const fd = new FormData();
    fd.set("price", "45");
    expect(await updateLineItem(QUOTE_ID, LINE_ID, fd)).toEqual({
      ok: false,
      error: "This proposal is frozen. Revise it before editing.",
    });
  });
});

describe("updateQuoteTerms", () => {
  it("commits a deposit amount", async () => {
    const fd = new FormData();
    fd.set("deposit_amount", "45");
    const result = await updateQuoteTerms(QUOTE_ID, fd);
    expect(result).toEqual({ ok: true });
    expect(db.quotes[0]?.deposit_amount).toBe(45);
  });

  it("commits an expiry date", async () => {
    const fd = new FormData();
    fd.set("expires_at", "2026-11-01");
    const result = await updateQuoteTerms(QUOTE_ID, fd);
    expect(result).toEqual({ ok: true });
    expect(db.quotes[0]?.expires_at).toBe("2026-11-01");
  });
});
