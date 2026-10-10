const OPEN = new Set(["draft", "sent", "viewed", "changed"]);

export type OpenQuote = { id: string; status: string; current_version: number; quote_versions: { version: number; quote_line_items: { service_id: string | null }[] | null }[] | null };

export function openQuotesByService(quotes: OpenQuote[]) {
  const counts = new Map<string, Set<string>>();
  for (const quote of quotes) {
    if (!OPEN.has(quote.status)) continue;
    const version = quote.quote_versions?.find((item) => item.version === quote.current_version);
    for (const line of version?.quote_line_items ?? []) {
      if (!line.service_id) continue;
      counts.set(line.service_id, (counts.get(line.service_id) ?? new Set()).add(quote.id));
    }
  }
  return counts;
}
export const tierSaveOptions = (choice: boolean) => ({ immediate: choice, rollback: choice });

export function allowClick(lock: { at: number }, now: number, wait = 600) {
  if (now - lock.at < wait) return false;
  lock.at = now; return true;
}
