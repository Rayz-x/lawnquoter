import { enqueueMutation, type CrewStore } from "./queue";

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
const KEY = "crew-enhancements";

export type PendingEnhancement = {
  clientId: string;
  visitId: string;
  userId: string;
  orgId: string;
  tag: string;
  note: string;
  photoClientId: string | null;
};

export function skipNeedsPhoto(reason: string) {
  return reason === "gate_locked" || reason === "dog_loose";
}

export function enhancementPayload(item: PendingEnhancement, photoId: string | null = null) {
  if (!TAGS.has(item.tag)) return null;
  if (item.photoClientId && !photoId) return null;
  const note = item.note.trim().slice(0, 2000);
  return { tag: item.tag, ...(note ? { note } : {}), photo_ids: photoId ? [photoId] : [] };
}

export async function sendReadyEnhancements(
  store: CrewStore,
  scope: { userId: string; orgId: string },
  pending: PendingEnhancement[],
  lookup: (photoClientId: string) => Promise<string | null>,
  now = new Date(),
) {
  const left: PendingEnhancement[] = [];
  for (const item of pending) {
    if (item.userId !== scope.userId || item.orgId !== scope.orgId) {
      left.push(item);
      continue;
    }
    const photoId = item.photoClientId ? await lookup(item.photoClientId) : null;
    const payload = enhancementPayload(item, photoId);
    if (!payload) {
      if (item.photoClientId && !photoId && TAGS.has(item.tag)) left.push(item);
      continue;
    }
    await enqueueMutation(store, {
      client_id: item.clientId,
      kind: "enhancement_create",
      visit_id: item.visitId,
      user_id: item.userId,
      org_id: item.orgId,
      payload,
    }, now);
  }
  return left;
}

type Box = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function readEnhancements(storage: Box, scope: string): PendingEnhancement[] {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) ?? "{}") as Record<string, PendingEnhancement[]>;
    return Array.isArray(parsed[scope]) ? parsed[scope] : [];
  } catch {
    return [];
  }
}

export function writeEnhancements(storage: Box, scope: string, items: PendingEnhancement[]) {
  let parsed: Record<string, PendingEnhancement[]> = {};
  try {
    parsed = JSON.parse(storage.getItem(KEY) ?? "{}") as Record<string, PendingEnhancement[]>;
  } catch {
    parsed = {};
  }
  storage.setItem(KEY, JSON.stringify({ ...parsed, [scope]: items }));
}
