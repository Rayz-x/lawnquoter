/** Pure helpers for crew visit time corrections (S17). */

export function reasonOk(reason: string | null | undefined): boolean {
  return Boolean(reason && reason.trim().length >= 1 && reason.trim().length <= 2000);
}

/** Format an ISO timestamp for `<input type="datetime-local">` in local time. */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse a datetime-local value to an ISO string, or null when empty/invalid. */
export function fromLocalInputValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function correctionPayload(input: {
  startedAt: string | null;
  completedAt: string | null;
  reason: string;
}): { started_at?: string; completed_at?: string; reason: string } | null {
  if (!reasonOk(input.reason)) return null;
  if (!input.startedAt && !input.completedAt) return null;
  const payload: { started_at?: string; completed_at?: string; reason: string } = {
    reason: input.reason.trim(),
  };
  if (input.startedAt) payload.started_at = input.startedAt;
  if (input.completedAt) payload.completed_at = input.completedAt;
  if (input.startedAt && input.completedAt && Date.parse(input.completedAt) < Date.parse(input.startedAt)) {
    return null;
  }
  return payload;
}
