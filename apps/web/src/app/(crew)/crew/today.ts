import { completionLabel } from "@/lib/crew/photo-pending";
import { gateWidthLabel, isNarrowGate } from "@/lib/property/gate";

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
  startedAt: string | null;
  skipReason: string | null;
  photoPending: boolean;
  photoLost: boolean;
  lat: number | null;
  lng: number | null;
  chips: AccessChip[];
};

export type DayPackView = {
  date: string;
  serverToday: string | null;
  crewId: string | null;
  crewName: string;
  officePhone: string | null;
  revision: number | null;
  version: number;
  stops: DayStop[];
};

/** Banner when the pack day and the phone's calendar day disagree. */
export type RouteDayBanner = "yesterday" | "mismatch" | null;

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
    const label = gateWidthLabel(property.gate_width_in);
    if (label) chips.push({ label, warning: isNarrowGate(property.gate_width_in) });
  }
  if (property.slope === "steep") chips.push({ label: "Steep", warning: true });
  if (property.has_stairs === true) chips.push({ label: "Stairs", warning: true });
  return chips;
}
const SKIP_LABELS: Record<string, string> = { gate_locked: "Gate locked", dog_loose: "Dog loose", customer_skip: "Customer skip", weather: "Weather", equipment: "Equipment", unsafe: "Unsafe", other: "Other" };
function skipLabel(reason: string | null) { return reason ? (SKIP_LABELS[reason] ?? reason) : null; }
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
      startedAt: text(visit.started_at),
      skipReason: skipLabel(text(visit.skip_reason)),
      photoPending: visit.photo_pending === true,
      photoLost: visit.photo_lost === true,
      lat: typeof property.lat === "number" ? property.lat : null,
      lng: typeof property.lng === "number" ? property.lng : null,
      chips: accessChips(property),
    });
  });
  const revision = typeof route?.revision === "number" ? route.revision : null;
  const version = typeof pack.version === "number" ? pack.version : (revision ?? 0);
  return {
    date: pack.date,
    serverToday: typeof pack.server_today === "string" ? pack.server_today : null,
    crewId: typeof crew?.id === "string" ? crew.id : null,
    crewName: text(crew?.name) ?? "Crew",
    officePhone: text(office?.phone),
    revision,
    version,
    stops,
  };
}
export function listRows(stops: DayStop[]) {
  const done = stops.filter((stop) => stop.status === "completed");
  const upNext = stops.find((stop) => stop.status === "in_progress" || stop.status === "paused") ?? stops.find((stop) => !CLOSED.has(stop.status)) ?? null;
  const rest = stops.filter((stop) => stop.status !== "completed" && stop.id !== upNext?.id);
  return { done, upNext, rest };
}
export function progressLabel(stops: DayStop[]): string {
  const done = stops.filter((stop) => stop.status === "completed").length;
  return `${done} of ${stops.length} stops done`;
}
export function finishLabel(stops: DayStop[], now: Date): string | null {
  const open = stops.filter((stop) => !CLOSED.has(stop.status));
  if (open.length === 0) return null;
  const minutes = open.reduce((sum, stop) => {
    const budget = stop.budgetMinutes ?? 0;
    const elapsed = stop.status === "in_progress" && stop.startedAt ? Math.max(0, (now.getTime() - Date.parse(stop.startedAt)) / 60_000) : 0;
    return sum + Math.max(0, budget - elapsed);
  }, 0);
  if (minutes <= 0) return "Running late";
  return `Finish ≈ ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(now.getTime() + minutes * 60_000))}`;
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

export function routeUpdateMessage(added: number[], removed: number[], at: Date): string | null {
  const part = (numbers: number[], verb: string) =>
    numbers.length === 0 ? "" : numbers.length === 1 ? `stop ${numbers[0]} ${verb}` : `${numbers.length} stops ${verb}`;
  const parts = [part(added, "added"), part(removed, "removed")].filter(Boolean);
  if (parts.length === 0) return null;
  return `Route updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at)}: ${parts.join(", ")}`;
}

/** Reorders keep the open visit; a stop removed from the pack closes it. */
export function shouldCloseOpenVisit(openId: string | null, previousIds: string[], nextIds: string[]): boolean {
  if (!openId) return false;
  const sameMembers =
    previousIds.length === nextIds.length && previousIds.every((id) => nextIds.includes(id));
  if (sameMembers) return false;
  return !nextIds.includes(openId);
}

export { phoneSyncStatus } from "@/lib/scheduling/phone-sync";

export function packIsFresh(savedAt: string, now: Date) {
  const age = now.getTime() - Date.parse(savedAt);
  return Number.isFinite(age) && age >= 0 && age <= 48 * 60 * 60 * 1000;
}

/**
 * Offline, keep today's pack or a fresh prior-day pack so a stale download
 * can still show "Yesterday's route". Future packs (fast phone clock) stay unused.
 */
export function offlineDayPack<T extends { date: string; savedAt: string }>(
  pack: T | null,
  phoneToday: string,
  now: Date,
): T | null {
  if (!pack || !packIsFresh(pack.savedAt, now)) return null;
  if (pack.date === phoneToday || pack.date < phoneToday) return pack;
  return null;
}

/** Prefer the phone's today pack; otherwise the newest fresh past pack. */
export function pickOfflinePack<T extends { date: string; saved_at: string }>(
  packs: T[],
  phoneToday: string,
  now: Date,
): T | null {
  const fresh = packs
    .filter((pack) => packIsFresh(pack.saved_at, now))
    .sort((a, b) => b.date.localeCompare(a.date));
  return fresh.find((pack) => pack.date === phoneToday) ?? fresh.find((pack) => pack.date < phoneToday) ?? null;
}

export function routeDayBanner(
  packDate: string,
  phoneToday: string,
  serverToday: string | null = null,
): RouteDayBanner {
  if (packDate === phoneToday) return null;
  // Org-correct pack while the phone calendar disagrees is a clock mismatch,
  // not a stale "Yesterday's route" download.
  if (serverToday && packDate === serverToday) return "mismatch";
  if (packDate > phoneToday) return "mismatch";
  const packMs = Date.parse(`${packDate}T12:00:00Z`);
  const todayMs = Date.parse(`${phoneToday}T12:00:00Z`);
  const days = Math.round((todayMs - packMs) / 86_400_000);
  return days === 1 ? "yesterday" : "mismatch";
}

export function routeDayBannerText(banner: RouteDayBanner, packDate?: string | null): string | null {
  if (banner === "yesterday") return "Yesterday's route";
  if (banner === "mismatch") {
    const when = packDate ? dayHeading(packDate).replace(/,/g, "") : null;
    return when
      ? `Your phone's date looks wrong. Showing the office's route for ${when}.`
      : "Your phone's date looks wrong. Showing the office's route.";
  }
  return null;
}

/** One warning bar for offline and/or route-day disagreement (avoids stacked banners). */
export function crewStatusBanner(
  online: boolean,
  banner: RouteDayBanner,
  packDate?: string | null,
): string | null {
  if (!online && banner === "yesterday") {
    return "No signal · Yesterday's route. Pull to refresh when you have signal.";
  }
  if (!online) {
    const day = routeDayBannerText(banner, packDate);
    return day ? `No signal · ${day}` : "No signal. Your work is saved on this phone.";
  }
  return routeDayBannerText(banner, packDate);
}

/** Prefer the server calendar day from the pack when the phone clock disagrees. */
export function packRequestDate(phoneToday: string, serverToday: string | null): string {
  return serverToday && serverToday !== phoneToday ? serverToday : phoneToday;
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

export function statusLabel(
  status: string,
  photo?: { photoPending?: boolean; photoLost?: boolean; afterQueued?: boolean; afterNeedsOffice?: boolean },
): string | null {
  if (status === "completed") {
    return completionLabel({
      status,
      photoPending: photo?.photoPending === true,
      photoLost: photo?.photoLost === true,
      afterQueued: photo?.afterQueued,
      afterNeedsOffice: photo?.afterNeedsOffice,
    });
  }
  return STATUS_LABELS[status] ?? null;
}

