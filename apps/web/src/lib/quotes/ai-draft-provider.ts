import { draftFromSimilarQuotes, type DraftProbe, type MemoryLine, type MemoryQuote } from "./neighborhood-draft";

export function aiQuoteDraftConfig(env: { AI_QUOTE_API_KEY?: string; AI_QUOTE_API_URL?: string }): { connected: boolean } {
  return { connected: Boolean(env.AI_QUOTE_API_KEY?.trim() && env.AI_QUOTE_API_URL?.trim()) };
}

export async function requestAiQuoteDraft(input: {
  fetchImpl: typeof fetch;
  url: string;
  apiKey: string;
  probe: DraftProbe;
  examples: MemoryQuote[];
}): Promise<MemoryLine[] | null> {
  let response: Response;
  try {
    response = await input.fetchImpl(input.url, {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ probe: input.probe, examples: input.examples }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const body = (await response.json()) as { lines?: MemoryLine[] } | null;
    const provided = body && Array.isArray(body.lines) ? body.lines : [];
    const lines = draftFromSimilarQuotes([{ id: "provider", postalCode: "", lotSqft: null, lat: null, lng: null, lines: provided }]);
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}
