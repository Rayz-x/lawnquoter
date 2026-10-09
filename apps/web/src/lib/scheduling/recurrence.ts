/**
 * Recurring visit dates. Mirrors `public.generate_agreement_visits`.
 *
 * weekly and custom step 7 days; biweekly steps 14; monthly keeps the start
 * date's day-of-month and clamps short months (31 Jan -> 28 Feb).
 * preferredDow is Postgres extract(dow): Sunday = 0 … Saturday = 6. It shifts
 * weekly, biweekly, and custom forward onto that weekday. custom requires it.
 * monthly ignores it and keeps the calendar day.
 * The office default horizon is 8 weeks; pass that date as `throughDate`.
 */

export const DEFAULT_VISIT_HORIZON_DAYS = 56;

export type VisitFrequency = "weekly" | "biweekly" | "monthly" | "custom";

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

/** Through-date the office UI should pass: the anchor plus 8 weeks, inclusive. */
export function defaultThroughDate(anchorDate: string): string {
  return addDays(anchorDate, DEFAULT_VISIT_HORIZON_DAYS);
}

function addMonths(iso: string, months: number): string {
  const date = parseDate(iso);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return formatDate(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last))));
}

function alignForward(iso: string, preferredDow: number): string {
  const delta = (preferredDow - parseDate(iso).getUTCDay() + 7) % 7;
  return addDays(iso, delta);
}

export function expandVisitDates(input: {
  startDate: string;
  throughDate: string;
  endDate?: string | null;
  frequency: VisitFrequency;
  preferredDow?: number | null;
}): string[] {
  const start = parseDate(input.startDate);
  parseDate(input.throughDate);
  if (input.endDate) parseDate(input.endDate);
  if (
    input.preferredDow != null &&
    (!Number.isInteger(input.preferredDow) || input.preferredDow < 0 || input.preferredDow > 6)
  ) {
    throw new Error("preferred day of week must be 0 through 6");
  }
  if (input.frequency === "custom" && input.preferredDow == null) {
    throw new Error("custom frequency needs a preferred day of week");
  }

  let until = input.throughDate;
  if (input.endDate && input.endDate < until) until = input.endDate;
  if (until < formatDate(start)) return [];

  const dates: string[] = [];
  if (input.frequency === "monthly") {
    for (let n = 0; n <= 600; n += 1) {
      const cursor = addMonths(input.startDate, n);
      if (cursor > until) break;
      if (cursor >= input.startDate) dates.push(cursor);
    }
    return dates;
  }

  const step = input.frequency === "biweekly" ? 14 : 7;
  let cursor = input.preferredDow == null ? input.startDate : alignForward(input.startDate, input.preferredDow);
  while (cursor <= until && dates.length <= 600) {
    dates.push(cursor);
    cursor = addDays(cursor, step);
  }
  return dates;
}
