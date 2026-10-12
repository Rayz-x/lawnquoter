import { describe, expect, it } from "vitest";
import { aiQuoteDraftConfig, requestAiQuoteDraft } from "./ai-draft-provider";
import { draftFromSimilarQuotes, draftLineSort, nearestSimilarQuotes, type MemoryQuote } from "./neighborhood-draft";

const probe = { postalCode: "37206", lotSqft: 8000, lat: 36.17, lng: -86.75 };

function quote(overrides: Partial<MemoryQuote> & Pick<MemoryQuote, "id">): MemoryQuote {
  return {
    postalCode: "37206",
    lotSqft: 8000,
    lat: null,
    lng: null,
    lines: [{ name: "Weekly mowing", price: 40, qty: 1, unit: "visit", state: "included" }],
    ...overrides,
  };
}

describe("nearestSimilarQuotes", () => {
  it("ranks a same-ZIP similar lot ahead of a far ZIP and a much larger lot", () => {
    const ranked = nearestSimilarQuotes(probe, [
      quote({ id: "large", lotSqft: 20000, lines: [{ name: "Weekly mowing", price: 120, qty: 1, unit: "visit", state: "included" }] }),
      quote({ id: "far", postalCode: "90210", lotSqft: 8100, lat: 34.05, lng: -118.24 }),
      quote({ id: "near", lotSqft: 8200, lines: [{ name: "Weekly mowing", price: 40, qty: 1, unit: "visit", state: "included" }] }),
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["near", "large", "far"]);
  });
});

describe("draftLineSort", () => {
  it("appends after the highest sort already on the quote", () => {
    expect(draftLineSort(4, 0)).toBe(5);
    expect(draftLineSort(null, 0)).toBe(0);
  });
});

describe("draftFromSimilarQuotes", () => {
  it("uses the median price of the same line across the nearest quotes", () => {
    const nearest = nearestSimilarQuotes(probe, [
      quote({ id: "near", lotSqft: 8200, lines: [{ name: "Weekly mowing", price: 40, qty: 1, unit: "visit", state: "included" }] }),
      quote({ id: "large", lotSqft: 9000, lines: [{ name: "Weekly mowing", price: 50, qty: 1, unit: "visit", state: "included" }] }),
    ]);
    expect(draftFromSimilarQuotes(nearest)).toEqual([
      { name: "Weekly mowing", price: 45, qty: 1, unit: "visit", state: "included" },
    ]);
  });
});

describe("AI quote provider", () => {
  it("stays off until both the key and the URL are set", () => {
    expect(aiQuoteDraftConfig({})).toEqual({ connected: false });
    expect(aiQuoteDraftConfig({ AI_QUOTE_API_KEY: "sk-test" })).toEqual({ connected: false });
    expect(aiQuoteDraftConfig({ AI_QUOTE_API_KEY: "sk-test", AI_QUOTE_API_URL: "https://example.test/draft" }).connected).toBe(true);
  });

  it("reads lines from a fake provider and ignores a bad response", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ lines: [{ name: "Weekly mowing", price: 42, qty: 1, unit: "visit", state: "included" }] }), {
        status: 200,
      })) as typeof fetch;
    const lines = await requestAiQuoteDraft({
      fetchImpl,
      url: "https://example.test/draft",
      apiKey: "sk-test",
      probe,
      examples: [],
    });
    expect(lines).toEqual([{ name: "Weekly mowing", price: 42, qty: 1, unit: "visit", state: "included" }]);

    const down = (async () => new Response("no", { status: 503 })) as typeof fetch;
    expect(await requestAiQuoteDraft({ fetchImpl: down, url: "https://example.test/draft", apiKey: "sk-test", probe, examples: [] })).toBeNull();

    const malformed = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
    expect(await requestAiQuoteDraft({ fetchImpl: malformed, url: "https://example.test/draft", apiKey: "sk-test", probe, examples: [] })).toBeNull();
  });
});
