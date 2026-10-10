import { beforeEach, describe, expect, it, vi } from "vitest";

const RULE_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

const mow = {
  type: "tier_matrix",
  quantityKey: "turf_sqft",
  rows: [
    { upTo: 5000, price: 40, hours: 0.5, cost: 18 },
    { upTo: 10000, price: 55, hours: 0.75, cost: 24 },
    { upTo: null, price: 70, hours: 1, cost: 32 },
  ],
};

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
      inserts.push(values);
      return api;
    },
    maybeSingle: async () => {
      const rows = tables[table] ?? [];
      const failure = rows.find((row) => typeof row.__error === "string")?.__error;
      if (typeof failure === "string") return { data: null, error: { message: failure } };
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

import { addPricedService } from "./actions";

function forgedForm() {
  const fd = new FormData();
  fd.set("rule_id", RULE_ID);
  fd.set("name", "Free mow");
  fd.set("price", "1");
  fd.set("hours", "99");
  fd.set("cost", "1");
  fd.set("range_low", "1");
  fd.set("range_high", "2");
  fd.set("state", "included");
  return fd;
}

beforeEach(() => {
  inserts.length = 0;
  tables.quote_versions = [{ id: VERSION_ID, quote_id: QUOTE_ID, org_id: "org-1", frozen: false }];
  tables.quotes = [{ id: QUOTE_ID, org_id: "org-1", property_id: "property-1" }];
  tables.pricing_rules = [{
    id: RULE_ID, org_id: "org-1", active: true, name: "Weekly mow", service_id: "service-1", price_list_id: "list-1", config: mow,
  }];
  tables.price_lists = [{ id: "list-1", org_id: "org-1", status: "active", modifiers: {} }];
  tables.properties = [{
    id: "property-1", org_id: "org-1", lot_sqft: 12000, slope: "steep", gate_width_in: null, obstacle_count: 0, has_stairs: false,
  }];
  tables.measurements = [{
    property_id: "property-1", status: "current", confidence: null,
    measurement_features: [{ category: "turf_front", area_sqft: 8000, length_ft: null }],
  }];
});

describe("addPricedService", () => {
  it("stores the catalog price for this property and ignores the client price", async () => {
    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());

    expect(result).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      name: "Weekly mow",
      service_id: "service-1",
      price: 68.75,
      hours: 1.05,
      cost: 33.6,
      range_low: null,
      range_high: null,
    });
  });

  it("prices a flat lot lower than a steep lot for the same forged price", async () => {
    tables.properties = [{ ...tables.properties[0], slope: null }];

    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());

    expect(result).toEqual({ ok: true });
    expect(inserts[0]?.price).toBe(55);
    expect(inserts[0]?.hours).toBe(0.75);
    expect(inserts[0]?.cost).toBe(24);
  });

  it("uses the rule's price list when another active list would price the line differently", async () => {
    tables.pricing_rules = [{ ...tables.pricing_rules[0], price_list_id: "list-used" }];
    tables.price_lists = [
      { id: "list-other", org_id: "org-1", status: "active", modifiers: { minimum: { price: 200 } } },
      { id: "list-used", org_id: "org-1", status: "active", modifiers: { minimum: { price: 80 } } },
    ];

    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());

    expect(result).toEqual({ ok: true });
    expect(inserts[0]?.price).toBe(80);
  });

  it.each(["quotes", "properties", "measurements", "pricing_rules", "price_lists"])(
    "does not price a line when the %s read fails",
    async (table) => {
      tables[table] = [{ __error: "read failed" }];
      const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());
      expect(result).toEqual({ ok: false, error: "read failed" });
      expect(inserts).toHaveLength(0);
    },
  );

  it("does not price a line when the property row is missing", async () => {
    tables.properties = [];
    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());
    expect(result).toEqual({ ok: false, error: "Property not found" });
    expect(inserts).toHaveLength(0);
  });

  it("does not price a rule from another company", async () => {
    tables.pricing_rules = [{ ...tables.pricing_rules[0], org_id: "org-2" }];
    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());
    expect(result).toEqual({ ok: false, error: "Pricing rule not found" });
    expect(inserts).toHaveLength(0);
  });

  it("does not charge a narrow gate when the width is zero", async () => {
    tables.properties = [{ ...tables.properties[0], gate_width_in: 0 }];
    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());
    expect(result).toEqual({ ok: true });
    expect(inserts[0]?.price).toBe(68.75);
  });

  it("does not price a line from an inactive price list", async () => {
    tables.price_lists = [{ ...tables.price_lists[0], status: "archived" }];

    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());

    expect(result).toEqual({ ok: false, error: "Price list is not active" });
    expect(inserts).toHaveLength(0);
  });

  it("does not insert a line when the rule's price list is missing", async () => {
    tables.pricing_rules = [{ ...tables.pricing_rules[0], price_list_id: "missing" }];

    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());

    expect(result).toEqual({ ok: false, error: "Price list not found" });
    expect(inserts).toHaveLength(0);
  });

  it("does not insert a line when the catalog rule is not active", async () => {
    tables.pricing_rules = [{ ...tables.pricing_rules[0], active: false }];

    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());

    expect(result).toEqual({ ok: false, error: "Pricing rule not found" });
    expect(inserts).toHaveLength(0);
  });

  it("rejects a frozen proposal before writing a price", async () => {
    tables.quote_versions = [{ ...tables.quote_versions[0], frozen: true }];

    const result = await addPricedService(QUOTE_ID, VERSION_ID, forgedForm());

    expect(result).toEqual({ ok: false, error: "This proposal is frozen. Revise it before editing." });
    expect(inserts).toHaveLength(0);
  });
});
