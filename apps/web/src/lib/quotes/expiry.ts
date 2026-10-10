import { addDays } from "@/lib/scheduling/recurrence";

/** Default when the org has not picked another quote_expiry_days setting. */
export const DEFAULT_QUOTE_EXPIRY_DAYS = 30;

export const QUOTE_EXPIRY_DAY_OPTIONS = [14, 30, 60, 90] as const;

export type QuoteExpiryDays = (typeof QUOTE_EXPIRY_DAY_OPTIONS)[number];

export function resolveQuoteExpiryDays(settingsDays: unknown): QuoteExpiryDays {
  const n = typeof settingsDays === "number" ? settingsDays : Number(settingsDays);
  if ((QUOTE_EXPIRY_DAY_OPTIONS as readonly number[]).includes(n)) {
    return n as QuoteExpiryDays;
  }
  return DEFAULT_QUOTE_EXPIRY_DAYS;
}

/** Calendar day the sent offer stops being acceptable (YYYY-MM-DD). */
export function quoteExpiresOn(sentOn: string, days: unknown = DEFAULT_QUOTE_EXPIRY_DAYS): string {
  return addDays(sentOn, resolveQuoteExpiryDays(days));
}
