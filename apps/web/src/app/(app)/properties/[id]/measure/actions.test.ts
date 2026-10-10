import { beforeEach, describe, expect, it, vi } from "vitest";

const PROPERTY_ID = "property-1";
const PREVIOUS_ID = "measurement-current";
const DRAFT_ID = "measurement-draft";

type Measurement = {
  id: string;
  property_id: string;
  org_id: string;
  status: string;
};

type Filter = { op: "eq" | "neq"; column: string; value: unknown };

const db = {
  measurements: [] as Measurement[],
  archiveError: null as string | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
};

function query(table: string) {
  const filters: Filter[] = [];
  let patch: Record<string, unknown> | null = null;
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return api;
    },
    neq(column: string, value: unknown) {
      filters.push({ op: "neq", column, value });
      return api;
    },
    update(values: Record<string, unknown>) {
      patch = values;
      return api;
    },
    insert() {
      return api;
    },
    single: async () => read(table, filters),
    maybeSingle: async () => read(table, filters),
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(write(table, filters, patch)).then(onFulfilled, onRejected);
    },
  };
  return api;
}

function matches(row: Record<string, unknown>, filters: Filter[]) {
  return filters.every((filter) =>
    filter.op === "eq" ? row[filter.column] === filter.value : row[filter.column] !== filter.value,
  );
}

function read(table: string, filters: Filter[]) {
  if (table === "properties") {
    const property = {
      id: PROPERTY_ID,
      org_id: "org-1",
      parcel_source: null,
      footprint_source: null,
      imagery_date: null,
      account_id: "account-1",
    };
    return matches(property, filters)
      ? { data: property, error: null }
      : { data: null, error: { message: "Property not found" } };
  }
  const row = db.measurements.find((measurement) => matches(measurement, filters)) ?? null;
  return { data: row, error: null };
}

function write(table: string, filters: Filter[], patch: Record<string, unknown> | null) {
  if (table === "measurements" && patch?.status === "archived" && db.archiveError) {
    return { data: null, error: { message: db.archiveError } };
  }
  if (table === "measurements" && patch) {
    for (const row of db.measurements) {
      if (matches(row, filters)) Object.assign(row, patch);
    }
  }
  return { data: [{ id: "row-1" }], error: null };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, args });
      return { data: null, error: null };
    },
  })),
}));

import { saveMeasurement } from "./actions";

const features = [
  {
    category: "turf_front" as const,
    source: "manual" as const,
    geometry: null,
    area_sqft: 1200,
    length_ft: null,
  },
];

beforeEach(() => {
  db.measurements = [
    { id: PREVIOUS_ID, property_id: PROPERTY_ID, org_id: "org-1", status: "current" },
    { id: DRAFT_ID, property_id: PROPERTY_ID, org_id: "org-1", status: "draft" },
  ];
  db.archiveError = null;
  db.rpcCalls = [];
});

describe("saveMeasurement", () => {
  it("fails and leaves the previous current measurement current when the archive update errors", async () => {
    db.archiveError = "could not archive the current measurement";

    const result = await saveMeasurement(PROPERTY_ID, DRAFT_ID, features);

    expect(db.rpcCalls.map((call) => call.fn)).toEqual(["measurement_replace_features"]);
    expect(result).toEqual({ ok: false, error: "could not archive the current measurement" });
    expect(db.measurements.find((row) => row.id === PREVIOUS_ID)?.status).toBe("current");
    expect(db.measurements.find((row) => row.id === DRAFT_ID)?.status).toBe("draft");
  });
});
