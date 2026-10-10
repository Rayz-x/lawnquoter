/** Age badge tone for lead response SLA against the org target (minutes). */
export type LeadAgeTone = "ok" | "amber" | "red";

export const DEFAULT_RESPONSE_TARGET_MINUTES = 60;

/**
 * Amber at half the target, red at/after the full target.
 * Default target is 60 minutes → amber at 30, red at 60.
 */
export function leadAgeTone(
  ageMinutes: number,
  targetMinutes: number = DEFAULT_RESPONSE_TARGET_MINUTES,
): LeadAgeTone {
  const target = Number.isFinite(targetMinutes) && targetMinutes > 0 ? targetMinutes : DEFAULT_RESPONSE_TARGET_MINUTES;
  if (ageMinutes >= target) return "red";
  if (ageMinutes >= target / 2) return "amber";
  return "ok";
}

export function leadAgeMinutes(createdAt: string | Date, now: Date = new Date()): number {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return Math.max(0, (now.getTime() - created.getTime()) / 60_000);
}
