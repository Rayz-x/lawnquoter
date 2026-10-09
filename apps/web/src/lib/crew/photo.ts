export const PHOTO_LIMIT = 460800;
export const JPEG_ATTEMPTS = [
  { edge: 1600, quality: 0.75 },
  { edge: 1600, quality: 0.6 },
  { edge: 1280, quality: 0.55 },
  { edge: 1024, quality: 0.5 },
  { edge: 800, quality: 0.45 },
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function scaledSize(width: number, height: number, edge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= edge || long <= 0) return { width, height };
  const scale = edge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function packPhotoKinds(data: unknown, visitId: string): string[] {
  const visits = Array.isArray(record(data)?.visits) ? (record(data)?.visits as unknown[]) : [];
  const visit = visits.map(record).find((item) => item?.id === visitId);
  const photos = Array.isArray(visit?.photos) ? visit.photos : [];
  return photos.flatMap((value) => {
    const kind = record(value)?.kind;
    return typeof kind === "string" ? [kind] : [];
  });
}

export function afterPhotoReady(savedKinds: string[], queued: { kind: string; needsOffice: boolean }[]): boolean {
  if (savedKinds.includes("after")) return true;
  return queued.some((row) => row.kind === "after" && !row.needsOffice);
}

/** Redraws the file so the stored JPEG has no camera metadata and fits the bucket. */
export async function downscalePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Could not read that photo.");
  }
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("Could not read that photo.");
    for (const attempt of JPEG_ATTEMPTS) {
      const size = scaledSize(bitmap.width, bitmap.height, attempt.edge);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not read that photo.");
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", attempt.quality));
      if (blob && blob.size > 0 && blob.size <= PHOTO_LIMIT) return blob;
    }
    throw new Error("That photo is too large.");
  } finally {
    bitmap.close();
  }
}
