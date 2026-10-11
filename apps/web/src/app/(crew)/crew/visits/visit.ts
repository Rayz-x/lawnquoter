import { scopeKey } from "@/lib/crew/queue";

export type Segment = { kind: "job" | "pause"; startedAt: string; endedAt: string | null };
export type VisitClock = { status: string; startedAt: string | null; crewSize: number | null; segments: Segment[]; applied: string[] };
export type VisitTask = { label: string; quantity: string | null; note: string | null };
export type VisitDetail = {
  id: string; number: number; status: string; title: string; address: string; lastName: string | null;
  budgetMinutes: number | null; startedAt: string | null; completedAt: string | null; crewSize: number | null; crewNote: string | null;
  gateCode: string | null; gateWidthIn: number | null; accessNotes: string | null; officeNotes: string | null;
  hasDogs: boolean; hasStairs: boolean; steep: boolean; lat: number | null; lng: number | null; tasks: VisitTask[];
  photoPending: boolean; photoLost: boolean;
  completedAfterCancel: boolean; forgotToFinish: boolean; completedByCrew: string | null;
};
export type ClockAction = { clientId: string; kind: "visit_start" | "visit_pause" | "visit_resume" | "visit_finish" | "visit_stop" | "visit_set_crew_size"; at: string; crewSize?: number };
type Box = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
const CLOCK_KEY = "crew-clocks";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function visitFromPack(data: unknown, visitId: string): VisitDetail | null {
  const visits = Array.isArray(record(data)?.visits) ? (record(data)?.visits as unknown[]) : [];
  const index = visits.findIndex((value) => record(value)?.id === visitId);
  const visit = record(visits[index]);
  const property = record(visit?.property);
  if (!visit || !property || index < 0) return null;
  const cancelled = visit.status === "cancelled";
  const tasks = Array.isArray(visit.tasks) ? visit.tasks : [];
  return {
    id: visitId, number: index + 1,
    status: typeof visit.status === "string" ? visit.status : "scheduled",
    title: text(visit.title) ?? "",
    address: text(property.formatted_address) ?? text(property.address_line1) ?? "Address unavailable",
    lastName: text(property.last_name),
    budgetMinutes: typeof visit.budget_minutes === "number" ? visit.budget_minutes : null,
    startedAt: text(visit.started_at),
    completedAt: text(visit.completed_at),
    crewSize: typeof visit.crew_size === "number" ? visit.crew_size : null,
    crewNote: text(visit.crew_note),
    gateCode: cancelled ? null : text(property.gate_code),
    gateWidthIn: typeof property.gate_width_in === "number" ? property.gate_width_in : null,
    accessNotes: cancelled ? null : text(property.access_notes),
    officeNotes: text(property.crew_notes),
    hasDogs: property.has_dogs === true, hasStairs: property.has_stairs === true, steep: property.slope === "steep",
    lat: typeof property.lat === "number" ? property.lat : null,
    lng: typeof property.lng === "number" ? property.lng : null,
    photoPending: visit.photo_pending === true,
    photoLost: visit.photo_lost === true,
    completedAfterCancel: visit.completed_after_cancel === true,
    forgotToFinish: visit.forgot_to_finish === true,
    completedByCrew: text(visit.completed_by_crew),
    tasks: tasks.flatMap((value) => {
      const task = record(value);
      const label = text(task?.label);
      return task && label ? [{ label, quantity: text(task.quantity_text), note: text(task.notes_crew) }] : [];
    }),
  };
}

/** Office cancelled after the crew had already started — Finish or Stop. */
export function isMidVisitCancel(detail: VisitDetail): boolean {
  return detail.status === "cancelled" && detail.startedAt !== null;
}

export function midVisitCancelMessage(): string {
  return "Office cancelled this stop. Finish or stop?";
}

export function alreadyDoneMessage(crewName: string | null): string {
  return crewName ? `Already done by ${crewName}` : "Already done by another crew";
}

/** Local clock still open, but the pack says another crew finished it. */
export function isAlreadyDoneByOtherCrew(detail: VisitDetail, clock: VisitClock | null, packCrewName: string | null): boolean {
  if (detail.status !== "completed" || !detail.completedByCrew) return false;
  if (packCrewName && detail.completedByCrew === packCrewName) {
    return Boolean(clock && (clock.status === "in_progress" || clock.status === "paused"));
  }
  return true;
}

export function visitsInPack(data: unknown): VisitDetail[] {
  const visits = Array.isArray(record(data)?.visits) ? (record(data)?.visits as unknown[]) : [];
  return visits.flatMap((value) => {
    const id = text(record(value)?.id);
    const visit = id ? visitFromPack(data, id) : null;
    return visit ? [visit] : [];
  });
}

export function seedClock(detail: VisitDetail): VisitClock {
  const open = detail.startedAt && (detail.status === "in_progress" || detail.status === "paused");
  return {
    status: detail.status, startedAt: detail.startedAt, crewSize: detail.crewSize, applied: [],
    segments: open ? [{ kind: detail.status === "paused" ? "pause" : "job", startedAt: detail.startedAt!, endedAt: null }] : [],
  };
}

function closeOpen(segments: Segment[], at: string): Segment[] {
  return segments.map((segment, index) => (index === segments.length - 1 && segment.endedAt === null ? { ...segment, endedAt: at } : segment));
}

export function applyClock(clock: VisitClock, action: ClockAction): VisitClock {
  if (clock.applied.includes(action.clientId)) return clock;
  const applied = [...clock.applied, action.clientId];
  if (action.kind === "visit_set_crew_size") {
    const size = action.crewSize;
    return size !== undefined && size >= 1 && size <= 12 ? { ...clock, applied, crewSize: size } : { ...clock, applied };
  }
  if (action.kind === "visit_start" && clock.status === "scheduled") {
    return { ...clock, applied, status: "in_progress", startedAt: clock.startedAt ?? action.at, segments: [...clock.segments, { kind: "job", startedAt: action.at, endedAt: null }] };
  }
  if (action.kind === "visit_pause" && clock.status === "in_progress") {
    return { ...clock, applied, status: "paused", segments: [...closeOpen(clock.segments, action.at), { kind: "pause", startedAt: action.at, endedAt: null }] };
  }
  if (action.kind === "visit_resume" && clock.status === "paused") {
    return { ...clock, applied, status: "in_progress", segments: [...closeOpen(clock.segments, action.at), { kind: "job", startedAt: action.at, endedAt: null }] };
  }
  if (action.kind === "visit_finish" && (clock.status === "in_progress" || clock.status === "paused" || clock.status === "cancelled")) {
    return { ...clock, applied, status: "completed", segments: closeOpen(clock.segments, action.at) };
  }
  if (action.kind === "visit_stop" && (clock.status === "in_progress" || clock.status === "paused" || clock.status === "cancelled")) {
    return { ...clock, applied, status: "cancelled", segments: closeOpen(clock.segments, action.at) };
  }
  return { ...clock, applied };
}

const TERMINAL = new Set(["completed", "skipped", "cant_complete", "cancelled"]);

export function projectVisit(detail: VisitDetail, stored: VisitClock | null, entries: Segment[] | null, pending: ClockAction[]): VisitClock {
  const seeded = seedClock(detail);
  const midCancel = isMidVisitCancel(detail);
  const closed = TERMINAL.has(detail.status) && !midCancel;
  let base: VisitClock;
  if (!closed && entries && entries.length > 0) {
    base = { ...seeded, segments: entries, applied: [] };
  } else if (midCancel && stored && (stored.status === "in_progress" || stored.status === "paused" || stored.status === "cancelled")) {
    base = { ...stored, status: "cancelled", startedAt: stored.startedAt ?? detail.startedAt };
  } else if (closed) {
    base = seeded;
  } else {
    base = stored ?? seeded;
  }
  return pending.reduce((clock, action) => applyClock(clock, action), base);
}

export function elapsedMs(segments: Segment[], now: Date): number {
  return segments.reduce((sum, segment) => {
    if (segment.kind !== "job") return sum;
    const start = Date.parse(segment.startedAt);
    const end = segment.endedAt ? Date.parse(segment.endedAt) : now.getTime();
    return Number.isFinite(start) && Number.isFinite(end) ? sum + Math.max(0, end - start) : sum;
  }, 0);
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function budgetLabel(elapsed: number, budgetMinutes: number | null): string | null {
  if (!budgetMinutes || budgetMinutes <= 0) return null;
  const over = Math.floor(elapsed / 60_000) - budgetMinutes;
  return over > 0 ? `Over by ${over} min` : null;
}

export function activeAddress(visits: VisitDetail[], visitId: string): string | null {
  return visits.find((visit) => visit.id !== visitId && (visit.status === "in_progress" || visit.status === "paused"))?.address ?? null;
}

export function patchVisitPack(
  data: unknown,
  visitId: string,
  patch: {
    status?: string;
    started_at?: string;
    completed_at?: string;
    crew_size?: number;
    skip_reason?: string;
    photo_pending?: boolean;
    photo_lost?: boolean;
  },
): unknown {
  const pack = record(data);
  if (!pack || !Array.isArray(pack.visits)) return data;
  return { ...pack, visits: pack.visits.map((value) => (record(value)?.id === visitId ? { ...record(value), ...patch } : value)) };
}

function clocks(storage: Box): Record<string, Record<string, VisitClock>> {
  try {
    const parsed = JSON.parse(storage.getItem(CLOCK_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Record<string, VisitClock>>) : {};
  } catch {
    return {};
  }
}

export function readClock(storage: Box, scope: string, visitId: string): VisitClock | null {
  const clock = clocks(storage)[scope]?.[visitId];
  return clock && Array.isArray(clock.segments) && Array.isArray(clock.applied) ? clock : null;
}

export function writeClock(storage: Box, scope: string, visitId: string, clock: VisitClock) {
  const parsed = clocks(storage);
  storage.setItem(CLOCK_KEY, JSON.stringify({ ...parsed, [scope]: { ...(parsed[scope] ?? {}), [visitId]: clock } }));
}

export function clearClocks(storage: Box) {
  storage.removeItem(CLOCK_KEY);
}

const LEAD_KEY = "crew-live-lead";

export function isLiveCrewLead(input: { userId: string; crewId: string | null; defaultLeadId: string | null; role: string | null; status: string | null }): boolean {
  return input.crewId !== null && input.defaultLeadId === input.userId && input.role === "crew_lead" && input.status === "active";
}

export function crewIdFromPack(data: unknown): string | null {
  const id = record(record(data)?.crew)?.id;
  return typeof id === "string" && id ? id : null;
}

export function crewNameFromPack(data: unknown): string | null {
  return text(record(record(data)?.crew)?.name);
}

export function leadFromReads(userId: string, crewId: string | null, crews: unknown, membership: unknown): boolean {
  const rows = Array.isArray(crews) ? crews : [];
  const crew = rows.map((value) => record(value)).find((row) => row?.id === crewId);
  const member = record(membership);
  return isLiveCrewLead({
    userId,
    crewId,
    defaultLeadId: typeof crew?.default_lead_id === "string" ? crew.default_lead_id : null,
    role: typeof member?.role === "string" ? member.role : null,
    status: typeof member?.status === "string" ? member.status : null,
  });
}

function leadScope(userId: string, orgId: string): string {
  return scopeKey(userId, orgId);
}

export function clearLiveLead(storage: Box) {
  storage.removeItem(LEAD_KEY);
}

export function cachedLiveLead(storage: Box, userId: string, orgId: string, crewId: string | null): boolean | null {
  if (!crewId) return null;
  try {
    const parsed = JSON.parse(storage.getItem(LEAD_KEY) ?? "{}") as Record<string, { crewId?: string; lead?: boolean }>;
    const row = parsed[leadScope(userId, orgId)];
    return row && row.crewId === crewId && typeof row.lead === "boolean" ? row.lead : null;
  } catch {
    return null;
  }
}

export function rememberLiveLead(storage: Box, userId: string, orgId: string, crewId: string, lead: boolean) {
  let parsed: Record<string, { crewId: string; lead: boolean }> = {};
  try {
    parsed = JSON.parse(storage.getItem(LEAD_KEY) ?? "{}") as Record<string, { crewId: string; lead: boolean }>;
  } catch {
    parsed = {};
  }
  storage.setItem(LEAD_KEY, JSON.stringify({ ...parsed, [leadScope(userId, orgId)]: { crewId, lead } }));
}

export function liveLeadFromPack(pack: unknown): boolean | null {
  const flagged = record(pack)?.is_live_lead;
  return typeof flagged === "boolean" ? flagged : null;
}

export function saveLeadForPack(storage: Box, userId: string, orgId: string, pack: unknown, crews: unknown, membership: unknown): boolean | null {
  const crewId = crewIdFromPack(pack);
  if (!crewId) return null;
  const flagged = liveLeadFromPack(pack);
  const live = flagged === null ? leadFromReads(userId, crewId, crews, membership) : flagged;
  rememberLiveLead(storage, userId, orgId, crewId, live);
  return live;
}
