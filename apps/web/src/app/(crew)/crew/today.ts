const CLOSED = new Set(["completed", "skipped", "cant_complete", "cancelled"]);

export type AccessChip = { label: string; warning: boolean };

export type DayStop = {
  id: string;
  number: number;
  status: string;
  title: string;
  address: string;
  lastName: string | null;
  budgetMinutes: number | null;
  skipReason: string | null;
  lat: number | null;
  lng: number | null;
  chips: AccessChip[];
};

export type DayPackView = {
  date: string;
  crewName: string;
  officePhone: string | null;
  revision: number | null;
  stops: DayStop[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function accessChips(property: Record<string, unknown>): AccessChip[] {
  const chips: AccessChip[] = [];
  if (text(property.gate_code)) chips.push({ label: "Gate code", warning: false });
  if (property.has_dogs === true) chips.push({ label: "Dog", warning: true });
  if (typeof property.gate_width_in === "number") {
    chips.push({ label: `${property.gate_width_in}″ gate`, warning: property.gate_width_in < 48 });
  }
  if (property.slope === "steep") chips.push({ label: "Steep", warning: true });
  if (property.has_stairs === true) chips.push({ label: "Stairs", warning: true });
  return chips;
}

function stopTitle(visit: Record<string, unknown>): string {
  const title = text(visit.title);
  if (title) return title;
  const tasks = Array.isArray(visit.tasks) ? visit.tasks : [];
  return tasks
    .map((task) => text(record(task)?.label))
    .filter((label): label is string => Boolean(label))
    .join(" · ");
}

export function parseDayPack(data: unknown): DayPackView | null {
  const pack = record(data);
  if (!pack || typeof pack.date !== "string") return null;
  const crew = record(pack.crew);
  const office = record(pack.office);
  const route = record(pack.route);
  const visits = Array.isArray(pack.visits) ? pack.visits : [];
  const stops: DayStop[] = [];
  visits.forEach((value, index) => {
    const visit = record(value);
    const property = record(visit?.property);
    if (!visit || typeof visit.id !== "string" || !property) return;
    const address = text(property.formatted_address) ?? text(property.address_line1) ?? "Address unavailable";
    stops.push({
      id: visit.id,
      number: index + 1,
      status: typeof visit.status === "string" ? visit.status : "scheduled",
      title: stopTitle(visit),
      address,
      lastName: text(property.last_name),
      budgetMinutes: typeof visit.budget_minutes === "number" ? visit.budget_minutes : null,
      skipReason: text(visit.skip_reason),
      lat: typeof property.lat === "number" ? property.lat : null,
      lng: typeof property.lng === "number" ? property.lng : null,
      chips: accessChips(property),
    });
  });
  return {
    date: pack.date,
    crewName: text(crew?.name) ?? "Crew",
    officePhone: text(office?.phone),
    revision: typeof route?.revision === "number" ? route.revision : null,
    stops,
  };
}

export function listRows(stops: DayStop[]) {
  const done = stops.filter((stop) => stop.status === "completed");
  const upNext = stops.find((stop) => !CLOSED.has(stop.status)) ?? null;
  const rest = stops.filter((stop) => stop.status !== "completed" && stop.id !== upNext?.id);
  return { done, upNext, rest };
}

export function progressLabel(stops: DayStop[]): string {
  const done = stops.filter((stop) => stop.status === "completed").length;
  return `${done} of ${stops.length} stops done`;
}

export function finishLabel(stops: DayStop[], now: Date): string | null {
  const minutes = stops.filter((stop) => !CLOSED.has(stop.status)).reduce((sum, stop) => sum + (stop.budgetMinutes ?? 0), 0);
  if (minutes <= 0) return null;
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(now.getTime() + minutes * 60_000));
  return `Finish ≈ ${clock}`;
}

export function dayHeading(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

export function syncPill(waiting: number, sending: boolean): string {
  if (sending) return "Sending…";
  if (waiting > 0) return `${waiting} waiting`;
  return "Synced";
}

export function driveUrl(lat: number, lng: number, ios: boolean): string {
  if (ios) return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function officeTel(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : null;
}

export function newStopIds(previousIds: string[], nextIds: string[]): string[] {
  const seen = new Set(previousIds);
  return nextIds.filter((id) => !seen.has(id));
}

export function routeUpdateMessage(numbers: number[], at: Date): string | null {
  if (numbers.length === 0) return null;
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at);
  if (numbers.length === 1) return `Route updated ${time}: stop ${numbers[0]} added`;
  return `Route updated ${time}: ${numbers.length} stops added`;
}

export function packErrorMessage(message: string): string {
  if (/not allowed/i.test(message)) return "Ask the office to add you to a crew.";
  return "Could not load the route.";
}

const STATUS_LABELS: Record<string, string> = {
  skipped: "Skipped",
  cant_complete: "Cannot finish",
  cancelled: "Cancelled",
  in_progress: "In progress",
  paused: "Paused",
};

export function statusLabel(status: string): string | null {
  return STATUS_LABELS[status] ?? null;
}

export const DISPLAY_MODES = ["light", "dark", "sun"] as const;
export type CrewDisplayMode = (typeof DISPLAY_MODES)[number];

export function nextDisplayMode(mode: CrewDisplayMode): CrewDisplayMode {
  return DISPLAY_MODES[(DISPLAY_MODES.indexOf(mode) + 1) % DISPLAY_MODES.length] ?? "light";
}
