import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const requireOrg = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireOrg }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));

import { activateCatalogDraft, installCatalogServices } from "./catalog-actions";
import { seasonDates } from "./catalog-season";

const owner = { userId: "user-1", email: null, orgId: "org-1", orgRole: "owner" as const };

beforeEach(() => {
  rpc.mockReset();
  requireOrg.mockResolvedValue(owner);
});

describe("catalog actions", () => {
  it("only owners and admins can install or activate", async () => {
    requireOrg.mockResolvedValue({ ...owner, orgRole: "sales" });
    expect((await installCatalogServices([{ key: "core-aeration", price: 17 }])).ok).toBe(false);
    expect((await activateCatalogDraft("33333333-3333-4333-8333-333333333333")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("builds validated rules from the seed at the chosen price", async () => {
    rpc.mockResolvedValue({ data: { ok: true, installed: 2, skipped: 0, price_list_id: "33333333-3333-4333-8333-333333333333" }, error: null });
    const result = await installCatalogServices([
      { key: "core-aeration", price: 20 },
      { key: "mulch-installation", price: 85.5 },
    ]);
    expect(result).toEqual({ ok: true, data: { installed: 2, skipped: 0, priceListId: "33333333-3333-4333-8333-333333333333" } });
    const entries = rpc.mock.calls[0]![1].p_entries;
    expect(rpc.mock.calls[0]![0]).toBe("install_catalog_services");
    expect(entries[0]).toMatchObject({
      key: "core-aeration",
      version: "2026-10-11",
      kind: "other",
      crew_task_name: "Core aerate",
      taxable: false,
      config: { type: "tier_matrix", quantityKey: "turf_sqft", rows: [{ upTo: 1000, price: 20 }] },
    });
    expect(entries[1]).toMatchObject({ key: "mulch-installation", is_material: true, config: { quantityKey: "bed_sqft" } });
  });

  it("rejects unknown keys and bad prices without calling the database", async () => {
    expect((await installCatalogServices([{ key: "tree-removal", price: 10 }])).ok).toBe(false);
    expect((await installCatalogServices([{ key: "core-aeration", price: -1 }])).ok).toBe(false);
    expect((await installCatalogServices([])).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never warns before a short window opens", () => {
    expect(seasonDates({ start: "04-01", end: "04-10" }, new Date("2026-01-05T12:00:00Z")).warn_date).toBe("2026-04-01");
  });

  it("puts a season window on its next occurrence", () => {
    expect(seasonDates({ start: "09-01", end: "10-31" }, new Date("2026-10-11T12:00:00Z"))).toEqual({
      window_start: "2026-09-01",
      window_end: "2026-10-31",
      warn_date: "2026-10-17",
    });
    expect(seasonDates({ start: "03-01", end: "05-15" }, new Date("2026-10-11T12:00:00Z"))).toEqual({
      window_start: "2027-03-01",
      window_end: "2027-05-15",
      warn_date: "2027-05-01",
    });
    expect(seasonDates(null, new Date())).toEqual({ window_start: null, window_end: null, warn_date: null });
  });

  it("activates the draft list", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await activateCatalogDraft("33333333-3333-4333-8333-333333333333")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("activate_price_list", { p_id: "33333333-3333-4333-8333-333333333333" });
  });
});
