import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupVendorPrice, vendorPriceStatus } from "./vendor-prices";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vendor price stubs", () => {
  it("stays disconnected until that supplier's key is set", () => {
    expect(vendorPriceStatus({})).toEqual({
      siteone: { connected: false, message: "Not connected - add SITEONE_API_KEY to enable" },
      homeDepot: { connected: false, message: "Not connected - add HOME_DEPOT_API_KEY to enable" },
    });
    expect(vendorPriceStatus({ SITEONE_API_KEY: " secret " }).siteone).toEqual({
      connected: true,
      message: "SiteOne key saved. Live prices stay off.",
    });
    expect(vendorPriceStatus({ SITEONE_API_KEY: " secret " }).homeDepot.connected).toBe(false);
  });

  it("does not call the catalog or the network while the key is missing", async () => {
    const client = vi.fn(async () => ({ sku: "MUL-1", name: "Brown mulch", unit: "cubic yard", unitCost: 42.5 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await lookupVendorPrice(
      { vendor: "siteone", sku: "MUL-1" },
      { env: { key: "  " }, client },
    );
    expect(result).toEqual({ ok: false, error: "Not connected - add SITEONE_API_KEY to enable" });
    expect(client).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the injected catalog price when the stub is switched on", async () => {
    const client = vi.fn(async () => ({ sku: "MUL-1", name: "Brown mulch", unit: "cubic yard", unitCost: 42.5 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await lookupVendorPrice(
      { vendor: "home_depot", sku: "MUL-1" },
      { env: { key: "secret" }, client },
    );
    expect(result).toEqual({
      ok: true,
      price: { sku: "MUL-1", name: "Brown mulch", unit: "cubic yard", unitCost: 42.5 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays off when the switch is on but no catalog client is installed", async () => {
    const result = await lookupVendorPrice(
      { vendor: "siteone", sku: "MUL-1" },
      { env: { key: "secret" } },
    );
    expect(result).toEqual({ ok: false, error: "Live prices stay off." });
  });
});
