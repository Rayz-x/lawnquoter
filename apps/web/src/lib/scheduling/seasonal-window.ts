/** Seasonal one-time service window (aeration / cleanup) with a warn date. */

export type SeasonalWindow = {
  windowStart: string | null;
  windowEnd: string | null;
  warnDate: string | null;
};

/** none = no window; ok = in window before warn; warn = red; cleared = scheduled. */
export type SeasonalWarnState = "none" | "ok" | "warn" | "cleared";

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** True when the service catalog row has a complete seasonal window. */
export function hasSeasonalWindow(window: SeasonalWindow): boolean {
  return isIsoDate(window.windowStart) && isIsoDate(window.windowEnd) && isIsoDate(window.warnDate);
}

/**
 * Red when as-of is on/after the warn date and the job is still unscheduled.
 * Scheduling clears the warning. Outside a configured window is `none`.
 */
export function seasonalWarnState(input: {
  asOf: string;
  window: SeasonalWindow;
  scheduled: boolean;
}): SeasonalWarnState {
  if (!isIsoDate(input.asOf) || !hasSeasonalWindow(input.window)) return "none";
  if (input.scheduled) return "cleared";

  const { windowStart, windowEnd, warnDate } = input.window;
  if (input.asOf < windowStart! || input.asOf > windowEnd!) return "ok";
  if (input.asOf >= warnDate!) return "warn";
  return "ok";
}

export function isSeasonalWarnRed(state: SeasonalWarnState): boolean {
  return state === "warn";
}

export function seasonalWarnBadgeLabel(state: SeasonalWarnState): string | null {
  return state === "warn" ? "Past warn date" : null;
}
