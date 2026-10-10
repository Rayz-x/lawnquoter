/** Month/day season window used by visit generation (org default or agreement override). */

export type SeasonWindow = {
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
};

/** LawnQuoter default mowing season. */
export const DEFAULT_SEASON: SeasonWindow = {
  startMonth: 4,
  startDay: 1,
  endMonth: 11,
  endDay: 15,
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseParts(iso: string): { year: number; month: number; day: number } {
  const match = DATE.exec(iso);
  if (!match) throw new Error("expected YYYY-MM-DD");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function md(month: number, day: number): number {
  return month * 100 + day;
}

/** True when the calendar date falls inside the season (supports wrap across year-end). */
export function isDateInSeason(isoDate: string, season: SeasonWindow = DEFAULT_SEASON): boolean {
  const { month, day } = parseParts(isoDate);
  const value = md(month, day);
  const start = md(season.startMonth, season.startDay);
  const end = md(season.endMonth, season.endDay);
  if (start <= end) return value >= start && value <= end;
  return value >= start || value <= end;
}

export function formatSeasonLabel(season: SeasonWindow = DEFAULT_SEASON): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const start = `${months[season.startMonth - 1]} ${season.startDay}`;
  const end = `${months[season.endMonth - 1]} ${season.endDay}`;
  return `${start}–${end}`;
}
