import { beforeEach, describe, expect, it, vi } from "vitest";

const QUOTE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
const inserts: Row[] = [];

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return api;
    },
    insert(values: Row) {
      inserts.push({ table, ...values });
      return api;
    },
    maybeSingle: async () => {
      const rows = tables[table] ?? [];
      const matched = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
      if (matched.length > 1) {
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      }
      return { data: matched[0] ?? null, error: null };
    },
    then(onFulfilled: (value: { data: { id: string }[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: [{ id: "line-1" }], error: null }).then(onFulfilled, onRejected);
    },
  };
  return api;
}

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
    from: (table: string) => query(table),
  })),
}));

import { addLineItem } from "./actions";

function lineForm(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("name", "Spring cleanup");
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  inserts.length = 0;
  tables.quote_versions = [{ id: VERSION_ID, quote_id: QUOTE_ID, org_id: "org-1", frozen: false }];
});

describe("addLineItem", () => {
  it("inserts a line when the price sits inside the range", async () => {
    const result = await addLineItem(
      QUOTE_ID,
      VERSION_ID,
      lineForm({ price: "100", range_low: "90", range_high: "120" }),
    );

    expect(result).toEqual({ ok: true, data: { sectionId: null } });
    expect(inserts).toEqual([
      expect.objectContaining({ table: "quote_line_items", price: 100, range_low: 90, range_high: 120 }),
    ]);
  });

  it("returns the frozen error and inserts nothing", async () => {
    tables.quote_versions = [{ id: VERSION_ID, quote_id: QUOTE_ID, org_id: "org-1", frozen: true }];

    const result = await addLineItem(QUOTE_ID, VERSION_ID, lineForm({ price: "100" }));

    expect(result).toEqual({ ok: false, error: "This proposal is frozen. Revise it before editing." });
    expect(inserts).toEqual([]);
  });

  it("accepts a price of 100 with a range of 1–2", async () => {
    const result = await addLineItem(
      QUOTE_ID,
      VERSION_ID,
      lineForm({ price: "100", range_low: "1", range_high: "2" }),
    );

    expect(result).toEqual({ ok: true, data: { sectionId: null } });
    expect(inserts).toEqual([
      expect.objectContaining({ table: "quote_line_items", price: 100, range_low: 1, range_high: 2 }),
    ]);
  });

  it("rejects a range whose low end is above the high end", async () => {
    const result = await addLineItem(
      QUOTE_ID,
      VERSION_ID,
      lineForm({ price: "15", range_low: "20", range_high: "10" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "The low end of the range cannot be above the high end.",
    });
    expect(inserts).toEqual([]);
  });
});
