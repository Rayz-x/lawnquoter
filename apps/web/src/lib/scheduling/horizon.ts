import { formatOfficeDay } from "@/lib/scheduling/office-date";

/** Rolling visit horizon: 10 weeks (upper end of the 8–10 week band). */
export const VISIT_HORIZON_DAYS = 70;

/** Copy shown on the agreement: furthest planned occurrence. */
export function nextVisitsThroughLabel(throughDate: string | null | undefined): string | null {
  if (!throughDate) return null;
  return `Next visits through ${formatOfficeDay(throughDate)}`;
}
