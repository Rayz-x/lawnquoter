import { addDays } from "./recurrence";

export type DispatchView = "day" | "week" | "crew";

export function parseDispatchView(value: string | undefined): DispatchView {
  if (value === "week" || value === "crew") return value;
  return "day";
}

/** Seven dates starting at `start`, inclusive. */
export function weekDates(start: string): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(start, offset));
}

export function scheduleHref(date: string, view: DispatchView, crewId?: string | null): string {
  const params = new URLSearchParams({ date });
  if (view !== "day") params.set("view", view);
  if (view === "crew" && crewId) params.set("crew", crewId);
  return `/schedule?${params.toString()}`;
}

export function shouldMoveVisit(
  from: { crewId: string | null; date: string | null },
  to: { crewId: string; date: string },
): boolean {
  if (!from.date) return true;
  return from.crewId !== to.crewId || from.date !== to.date;
}
