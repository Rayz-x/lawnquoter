/**
 * Office date helpers. Visit dates are expanded in
 * public.generate_agreement_visits.
 */

/** Office default matches the rolling nightly horizon (about 10 weeks). */
export const DEFAULT_VISIT_HORIZON_DAYS = 70;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(value: string): Date {
  const match = DATE.exec(value);
  if (!match) throw new Error("expected YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("expected YYYY-MM-DD");
  }
  return date;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const date = parseDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

/** Through-date the office UI should pass: the anchor plus 10 weeks, inclusive. */
export function defaultThroughDate(anchorDate: string): string {
  return addDays(anchorDate, DEFAULT_VISIT_HORIZON_DAYS);
}
