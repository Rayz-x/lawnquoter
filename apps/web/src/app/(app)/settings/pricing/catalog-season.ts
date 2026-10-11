import type { CatalogEntry } from "@lawnquoter/pricing-engine";

/** Season window (MM-DD) and warn date on its current or next occurrence. Windows that ended this year roll to next year. */
export function seasonDates(season: CatalogEntry["season"], now: Date) {
  if (!season) return { window_start: null, window_end: null, warn_date: null };
  const year = now.getUTCFullYear();
  const today = now.toISOString().slice(0, 10);
  const end = `${year}-${season.end}`;
  const useYear = end < today ? year + 1 : year;
  const window_start = `${useYear}-${season.start}`;
  const window_end = `${useYear}-${season.end}`;
  // Warn two weeks before the window closes, never before it opens.
  const warn = new Date(`${window_end}T00:00:00Z`);
  warn.setUTCDate(warn.getUTCDate() - 14);
  const warnIso = warn.toISOString().slice(0, 10);
  return { window_start, window_end, warn_date: warnIso < window_start ? window_start : warnIso };
}

