export const CREW_STATUSES = ["en_route", "on_site", "break", "done"] as const;

export type CrewStatus = (typeof CREW_STATUSES)[number];

export type CrewPresence = {
  crewId: string;
  state: CrewStatus;
  visitId: string | null;
};

const LABELS: Record<CrewStatus, string> = {
  en_route: "En route",
  on_site: "On site",
  break: "On break",
  done: "Done",
};

export function isCrewStatus(value: string): value is CrewStatus {
  return (CREW_STATUSES as readonly string[]).includes(value);
}

export function crewStatusLabel(state: CrewStatus): string {
  return LABELS[state];
}

/** Replace one crew's status. A second crew stays in the list. */
export function applyCrewPresence(current: CrewPresence[], next: CrewPresence): CrewPresence[] {
  const rest = current.filter((row) => row.crewId !== next.crewId);
  return [...rest, next];
}

export function presenceFromChange(row: unknown): CrewPresence | null {
  if (!row || typeof row !== "object") return null;
  const value = row as { crew_id?: unknown; state?: unknown; visit_id?: unknown };
  if (typeof value.crew_id !== "string" || typeof value.state !== "string" || !isCrewStatus(value.state)) return null;
  return {
    crewId: value.crew_id,
    state: value.state,
    visitId: typeof value.visit_id === "string" ? value.visit_id : null,
  };
}
