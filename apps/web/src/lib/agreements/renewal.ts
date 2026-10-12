/** Season price after a percent increase, rounded to the nearest cent. */
export function renewalPrice(cents: number, percent: number): number | null {
  if (!Number.isInteger(cents) || cents <= 0) return null;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return Math.round((cents * (100 + percent)) / 100);
}

/** An agreement is due when its end date falls inside the window, including today. */
export function dueForRenewal(endDate: string, today: string, windowDays: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  if (!Number.isInteger(windowDays) || windowDays < 1) return false;
  if (endDate < today) return false;
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const start = Date.parse(`${today}T00:00:00Z`);
  const latest = start + windowDays * 86400000;
  return end <= latest;
}
