import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Array<Record<string, unknown>> = [];
const rpc = vi.fn(async () => ({ data: null, error: null }));

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

const resolvePropertyGeo = vi.fn();
vi.mock("@/lib/geo/resolve", () => ({
  resolvePropertyGeo: (...args: unknown[]) => resolvePropertyGeo(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => query,
    rpc,
  })),
}));

const before = {
  address_line1: "1 Main St",
  city: "Austin",
  region: "TX",
  postal_code: "78701",
  account_id: "account-1",
};

const query = {
  select() {
    return query;
  },
  eq() {
    return query;
  },
  update(values: Record<string, unknown>) {
    updates.push(values);
    return query;
  },
  maybeSingle: async () => ({ data: before, error: null }),
  then(resolve: (value: { data: null; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve({ data: null, error: null }).then(resolve, reject);
  },
};

import { updateProperty } from "./actions";

function propertyForm(addressLine1 = "100 Oak St") {
  const fd = new FormData();
  fd.set("address_line1", addressLine1);
  fd.set("address_line2", "");
  fd.set("city", "Austin");
  fd.set("region", "TX");
  fd.set("postal_code", "78701");
  fd.set("gate_width_in", "");
  fd.set("slope", "");
  fd.set("obstacle_count", "0");
  return fd;
}

beforeEach(() => {
  updates.length = 0;
  rpc.mockClear();
  resolvePropertyGeo.mockReset();
});

describe("updateProperty geocode miss", () => {
  it("clears the stored pin, place id, parcel, and building outline when the new address does not geocode", async () => {
    resolvePropertyGeo.mockResolvedValue({
      geocode: null,
      parcel: null,
      footprint: null,
      warnings: ["Address could not be geocoded."],
    });

    const result = await updateProperty("property-1", propertyForm());

    expect(result).toEqual({ ok: true, data: { warnings: ["Address could not be geocoded."] } });
    expect(updates).toContainEqual(
      expect.objectContaining({
        place_id: null,
        location: null,
        parcel: null,
        footprint: null,
      }),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the existing pin when the address is unchanged", async () => {
    resolvePropertyGeo.mockResolvedValue({
      geocode: null,
      parcel: null,
      footprint: null,
      warnings: ["Address could not be geocoded."],
    });

    await updateProperty("property-1", propertyForm("1 Main St"));

    expect(updates.some((update) => update.location === null)).toBe(false);
    expect(resolvePropertyGeo).not.toHaveBeenCalled();
  });
});
