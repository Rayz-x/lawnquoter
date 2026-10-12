const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SITE_WALK_PHOTO_BUCKET = "site-walk-photos";
export const SITE_WALK_PHOTO_MAX_BYTES = 2_097_152;

export function walkCoordinate(raw: string, axis: "lat" | "lng"): number | null {
  const text = raw.trim();
  if (!text) return null;
  const number = Number(text);
  const limit = axis === "lat" ? 90 : 180;
  if (!Number.isFinite(number) || number < -limit || number > limit) return null;
  return number;
}

export function walkPhotoPath(orgId: string, fileId: string, mime: string): string | null {
  const ext = PHOTO_EXT[mime];
  if (!ext || !UUID.test(orgId) || !UUID.test(fileId)) return null;
  return `${orgId}/${fileId}.${ext}`;
}

export type WalkPin = { id: string; body: string; lng: number; lat: number };

export function walkPins(
  notes: { id: string; body: string; lat: number | null; lng: number | null }[],
): WalkPin[] {
  return notes.flatMap((note) => {
    if (note.lat == null || note.lng == null) return [];
    if (!Number.isFinite(note.lat) || !Number.isFinite(note.lng)) return [];
    if (note.lat < -90 || note.lat > 90 || note.lng < -180 || note.lng > 180) return [];
    return [{ id: note.id, body: note.body, lng: note.lng, lat: note.lat }];
  });
}
