/** Columns the crew today list is allowed to read. Address, status, tasks, minutes. */
export const CREW_TODAY_SELECTS = {
  membership: "crew_id",
  route: "id",
  visit: "id, status, budget_minutes, sort, property_id",
  property: "id, formatted_address, address_line1",
  task: "visit_id, label, sort",
} as const;

const FORBIDDEN_SELECT_TOKENS = [
  "gate_code",
  "access_notes",
  "phone",
  "email",
  "price",
  "cost",
  "margin",
  "billing",
  "contact",
  "accounts",
  "contacts",
  "note_office",
] as const;

export function crewTodaySelectsAreFieldSafe(selects: Record<string, string> = CREW_TODAY_SELECTS): boolean {
  const haystack = Object.values(selects).join(" ").toLowerCase();
  return FORBIDDEN_SELECT_TOKENS.every((token) => !haystack.includes(token));
}

const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  skipped: "Skipped",
  cant_complete: "Can't complete",
  cancelled: "Cancelled",
};

export function visitStatusLabel(status: string): string {
  return VISIT_STATUS_LABELS[status] ?? status;
}

export function budgetMinutesLabel(minutes: number | null): string {
  if (minutes == null) return "—";
  return `${minutes} min`;
}

/** Org-local calendar day as YYYY-MM-DD. Invalid zones fall back to UTC, matching private.org_local_today. */
export function orgLocalDate(timeZone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (!year || !month || !day) return utcDate(now);
    return `${year}-${month}-${day}`;
  } catch {
    return utcDate(now);
  }
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type CrewVisitRow = {
  id: string;
  status: string;
  budget_minutes: number | null;
  sort: number;
  property_id: string;
};

export type CrewPropertyAddress = {
  id: string;
  formatted_address: string | null;
  address_line1: string | null;
};

export type CrewTaskRow = {
  visit_id: string;
  label: string;
  sort: number;
};

export type CrewStop = {
  id: string;
  address: string;
  statusLabel: string;
  budgetLabel: string;
  tasks: string[];
};

export function propertyAddress(property: CrewPropertyAddress | undefined): string {
  const address = property?.formatted_address?.trim() || property?.address_line1?.trim();
  return address || "Address unavailable";
}

export function assembleStops(
  visits: CrewVisitRow[],
  properties: CrewPropertyAddress[],
  tasks: CrewTaskRow[],
): CrewStop[] {
  const addresses = new Map(properties.map((property) => [property.id, property]));
  const tasksByVisit = new Map<string, CrewTaskRow[]>();
  for (const task of tasks) {
    const list = tasksByVisit.get(task.visit_id) ?? [];
    list.push(task);
    tasksByVisit.set(task.visit_id, list);
  }

  return [...visits]
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map((visit) => ({
      id: visit.id,
      address: propertyAddress(addresses.get(visit.property_id)),
      statusLabel: visitStatusLabel(visit.status),
      budgetLabel: budgetMinutesLabel(visit.budget_minutes),
      tasks: (tasksByVisit.get(visit.id) ?? [])
        .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
        .map((task) => task.label),
    }));
}
