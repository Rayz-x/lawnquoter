import { enqueueMutation, type CrewPayload, type CrewStore } from "./queue";

export const SKIP_REASONS = [
  ["gate_locked", "Gate locked"],
  ["dog_loose", "Dog loose"],
  ["customer_skip", "Customer skip"],
  ["weather", "Weather"],
  ["equipment", "Equipment"],
  ["unsafe", "Unsafe"],
  ["other", "Other"],
] as const;

export const ENHANCEMENT_TAGS = [
  ["aeration", "Aeration"],
  ["overseed", "Overseed"],
  ["mulch", "Mulch"],
  ["shrub_tree", "Shrub/Tree"],
  ["drainage", "Drainage"],
  ["other", "Other"],
] as const;

const TAGS = new Set<string>(ENHANCEMENT_TAGS.map(([tag]) => tag));
const REASONS = new Set<string>(SKIP_REASONS.map(([reason]) => reason));

export function skipNeedsPhoto(reason: string) {
  return reason === "gate_locked" || reason === "dog_loose";
}

/** Gate/dog proof uses the after-photo rule (kind + uploaded file). */
export function skipPhotoKind(reason: string): "after" | null {
  return skipNeedsPhoto(reason) ? "after" : null;
}

export function skipNeedsNote(reason: string) {
  return reason === "unsafe";
}

export function skipPayload(reason: string, note: string): CrewPayload | null {
  if (!REASONS.has(reason)) return null;
  const trimmed = note.trim().slice(0, 2000);
  if (skipNeedsNote(reason) && !trimmed) return null;
  return { reason, ...(trimmed ? { note: trimmed } : {}) };
}

export function enhancementPayload(tag: string, note: string, photoId: string | null = null): CrewPayload | null {
  if (!TAGS.has(tag)) return null;
  const trimmed = note.trim().slice(0, 2000);
  return { tag, ...(trimmed ? { note: trimmed } : {}), ...(photoId ? { photo_client_id: photoId } : { photo_ids: [] }) };
}

/** The upsell row is queued immediately. A photo id is filled in after that photo syncs. */
export async function queueEnhancement(
  store: CrewStore,
  input: { clientId: string; visitId: string; userId: string; orgId: string; tag: string; note: string },
  photoClientId: string | null,
  now = new Date(),
) {
  const payload = enhancementPayload(input.tag, input.note, photoClientId);
  if (!payload) return null;
  return enqueueMutation(
    store,
    {
      client_id: input.clientId,
      kind: "enhancement_create",
      visit_id: input.visitId,
      user_id: input.userId,
      org_id: input.orgId,
      payload,
    },
    photoClientId ? new Date(now.getTime() + 1) : now,
  );
}
