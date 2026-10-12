export type VendorId = "siteone" | "home_depot";

export type VendorPrice = { sku: string; name: string; unit: string; unitCost: number };

export type VendorPriceClient = (input: { vendor: VendorId; sku: string }) => Promise<VendorPrice>;

export type VendorPriceEnv = Record<string, string | undefined>;

const SITEONE_OFF = "Not connected - add SITEONE_API_KEY to enable";
const HOME_DEPOT_OFF = "Not connected - add HOME_DEPOT_API_KEY to enable";

function saved(key: string | undefined) {
  return Boolean(key?.trim());
}

/** Supplier catalogs stay off until that supplier's key is set. A key never places a network call by itself. */
export function vendorPriceStatus(env: VendorPriceEnv) {
  return {
    siteone: saved(env.SITEONE_API_KEY)
      ? { connected: true, message: "SiteOne key saved. Live prices stay off." }
      : { connected: false, message: SITEONE_OFF },
    homeDepot: saved(env.HOME_DEPOT_API_KEY)
      ? { connected: true, message: "Home Depot key saved. Live prices stay off." }
      : { connected: false, message: HOME_DEPOT_OFF },
  };
}

export type VendorPriceStatus = ReturnType<typeof vendorPriceStatus>;

/**
 * Price one SKU from an injected catalog client.
 * With no client, this never calls the network, even when a key is present.
 */
export async function lookupVendorPrice(
  input: { vendor: VendorId; sku: string },
  deps: { env: { key?: string }; client?: VendorPriceClient },
): Promise<{ ok: true; price: VendorPrice } | { ok: false; error: string }> {
  if (!deps.env.key?.trim()) {
    return { ok: false, error: input.vendor === "siteone" ? SITEONE_OFF : HOME_DEPOT_OFF };
  }
  if (!deps.client) return { ok: false, error: "Live prices stay off." };
  const price = await deps.client(input);
  if (!Number.isFinite(price.unitCost) || price.unitCost < 0) return { ok: false, error: "Vendor returned no price." };
  return { ok: true, price };
}
