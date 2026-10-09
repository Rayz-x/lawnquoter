import { addDays } from "@/lib/scheduling/recurrence";

export function isIsoDate(value: string): boolean {
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}

function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Calendar day in the org timezone, as YYYY-MM-DD. */
export function orgToday(timeZone: string | null | undefined, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function formatOfficeDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}
