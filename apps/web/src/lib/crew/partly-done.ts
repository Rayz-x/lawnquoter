/** Crew "Partly done" finish validation (S12). */

export const PARTLY_DONE_REASON_MAX = 500;

export type PartlyDoneInput = {
  reason: string;
  hasAfterPhoto: boolean;
};

export function normalizePartlyDoneReason(reason: string): string {
  return reason.trim().slice(0, PARTLY_DONE_REASON_MAX);
}

/** True when the lead may submit a partly-done finish. */
export function canSubmitPartlyDone(input: PartlyDoneInput): boolean {
  return Boolean(normalizePartlyDoneReason(input.reason)) && input.hasAfterPhoto;
}

export function partlyDoneFinishPayload(reason: string): { outcome: "partly"; reason: string } | null {
  const trimmed = normalizePartlyDoneReason(reason);
  if (!trimmed) return null;
  return { outcome: "partly", reason: trimmed };
}
