import { priceSnow, type SnowRule } from "@lawnquoter/pricing-engine";

export const SNOW_CONTRACTS = ["per_push", "per_inch", "seasonal_flat"] as const;
export type SnowContract = (typeof SNOW_CONTRACTS)[number];

export type SnowTier = { upTo: number | null; price: number };

export function isSnowContract(value: string): value is SnowContract {
  return (SNOW_CONTRACTS as readonly string[]).includes(value);
}

export function snowRule(input: {
  contract: SnowContract;
  triggerDepthIn: number;
  price: number;
  tiers?: SnowTier[];
}): SnowRule {
  const triggerDepthIn = input.triggerDepthIn;
  if (input.contract === "seasonal_flat") {
    return { type: "snow", contract: "seasonal_flat", triggerDepthIn, seasonal: { price: input.price, hours: 0, cost: 0 } };
  }
  if (input.contract === "per_inch") {
    const tiers = (input.tiers?.length ? input.tiers : [{ upTo: null, price: input.price }]).map((tier) => ({
      upTo: tier.upTo,
      price: tier.price,
      hours: 0,
      cost: 0,
    }));
    return { type: "snow", contract: "per_inch", triggerDepthIn, inchTiers: tiers };
  }
  return { type: "snow", contract: "per_push", triggerDepthIn, perPush: { price: input.price, hours: 0, cost: 0 } };
}

export function parseSnowTiers(value: unknown): SnowTier[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tiers: SnowTier[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const row = item as { upTo?: unknown; price?: unknown };
    const price = typeof row.price === "number" ? row.price : Number(row.price);
    const upTo = row.upTo == null ? null : typeof row.upTo === "number" ? row.upTo : Number(row.upTo);
    if (!Number.isFinite(price) || (upTo != null && !Number.isFinite(upTo))) return undefined;
    tiers.push({ upTo, price });
  }
  return tiers;
}

/** Dollar price for one snowfall. Below the trigger is zero except on a seasonal contract. */
export function snowPushPrice(
  input: {
    contract: SnowContract;
    triggerDepthIn: number;
    price: number;
    tiers?: SnowTier[];
  },
  inches: number,
): number {
  return priceSnow(snowRule(input), { inches }).price;
}
