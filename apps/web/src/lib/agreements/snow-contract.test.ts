import { describe, expect, it } from "vitest";
import { snowPushPrice } from "./snow-contract";

describe("snow contract price", () => {
  it("charges a per-push price only at or above the trigger", () => {
    const contract = { contract: "per_push" as const, triggerDepthIn: 2, price: 55 };
    expect(snowPushPrice(contract, 1)).toBe(0);
    expect(snowPushPrice(contract, 2)).toBe(55);
  });

  it("uses the matching per-inch tier", () => {
    const price = snowPushPrice(
      {
        contract: "per_inch",
        triggerDepthIn: 1,
        price: 120,
        tiers: [
          { upTo: 2, price: 45 },
          { upTo: 6, price: 75 },
          { upTo: null, price: 120 },
        ],
      },
      3,
    );
    expect(price).toBe(75);
  });

  it("keeps the seasonal price below the trigger", () => {
    expect(snowPushPrice({ contract: "seasonal_flat", triggerDepthIn: 2, price: 400 }, 0)).toBe(400);
  });
});
