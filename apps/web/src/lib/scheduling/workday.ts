/** ISO date YYYY-MM-DD helpers for rain-day next-workday math. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(date: string): Date {
  const match = ISO.exec(date);
  if (!match) throw new Error(`invalid date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIso(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** UTC day-of-week: 0 = Sunday … 6 = Saturday (matches Postgres extract(dow)). */
function utcDow(date: Date): number {
  return date.getUTCDay();
}

export type WorkdayOptions = {
  saturdayWorkday?: boolean;
};

/** Next workday after `from` (exclusive). Saturday off unless opted in. */
export function nextWorkday(from: string, options: WorkdayOptions = {}): string {
  const saturdayWorkday = options.saturdayWorkday === true;
  const cursor = parseIso(from);
  for (let i = 0; i < 14; i += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = utcDow(cursor);
    if (dow >= 1 && dow <= 5) return formatIso(cursor);
    if (saturdayWorkday && dow === 6) return formatIso(cursor);
  }
  throw new Error("could not find a workday");
}
