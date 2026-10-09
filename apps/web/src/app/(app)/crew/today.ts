/** Columns the crew today list is allowed to read. Address, status, tasks, minutes. */
export const CREW_TODAY_SELECTS = {
  route: "id",
  visit: "id, status, budget_minutes, sort, property_id",
  property: "id, formatted_address, address_line1",
  task: "visit_id, label, sort",
} as const;

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

/** One member inside public.my_crews(). No email or phone. */
export type MyCrewMember = {
  profile_id: string;
  full_name: string | null;
};

/** Row from public.my_crews(). */
export type MyCrew = {
  id: string;
  name: string;
  active: boolean;
  default_lead_id: string | null;
  members: MyCrewMember[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMember(value: unknown): MyCrewMember | null {
  if (!isRecord(value) || typeof value.profile_id !== "string" || value.profile_id.length === 0) return null;
  return {
    profile_id: value.profile_id,
    full_name: typeof value.full_name === "string" ? value.full_name : null,
  };
}

/** Reads the jsonb array from public.my_crews(). */
export function parseMyCrews(data: unknown): MyCrew[] {
  if (!Array.isArray(data)) return [];
  const crews: MyCrew[] = [];
  for (const row of data) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.name !== "string") continue;
    const members = Array.isArray(row.members) ? row.members.flatMap((member) => {
      const parsed = parseMember(member);
      return parsed ? [parsed] : [];
    }) : [];
    crews.push({
      id: row.id,
      name: row.name,
      active: row.active !== false,
      default_lead_id: typeof row.default_lead_id === "string" ? row.default_lead_id : null,
      members,
    });
  }
  return crews;
}

export function crewIdsFromMyCrews(crews: MyCrew[]): string[] {
  return [...new Set(crews.map((crew) => crew.id).filter((id) => id.length > 0))];
}

export function crewNameLabel(crews: MyCrew[]): string {
  return [
    ...new Set(
      crews
        .filter((crew) => crew.id.length > 0)
        .map((crew) => crew.name.trim())
        .filter((name) => name.length > 0),
    ),
  ].join(", ");
}

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
