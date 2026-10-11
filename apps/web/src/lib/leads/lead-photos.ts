/** Private lead-form photo bucket (L13). Uploads go through the intake admin client. */
export const LEAD_PHOTOS_BUCKET = "lead-photos";

/** Up to 3 images on the public form. */
export const LEAD_PHOTO_MAX_COUNT = 3;

/** 2 MiB per image — bucket file_size_limit matches. */
export const LEAD_PHOTO_MAX_BYTES = 2_097_152;

export const LEAD_PHOTO_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type LeadPhotoAllowedMime = (typeof LEAD_PHOTO_ALLOWED_MIME)[number];

export type LeadPhotoCandidate = {
  mimeType: string;
  byteLength: number;
};

export type LeadPhotoFile = LeadPhotoCandidate & {
  body: Blob | ArrayBuffer | Uint8Array;
};

export type LeadPhotoValidation =
  | { ok: true }
  | { ok: false; reason: "too_many" | "non_image" | "too_large" };

const MIME_TO_EXT: Record<LeadPhotoAllowedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedLeadPhotoMime(mimeType: string): mimeType is LeadPhotoAllowedMime {
  return (LEAD_PHOTO_ALLOWED_MIME as readonly string[]).includes(mimeType);
}

export function validateLeadPhotoCandidates(
  photos: LeadPhotoCandidate[],
): LeadPhotoValidation {
  if (photos.length > LEAD_PHOTO_MAX_COUNT) {
    return { ok: false, reason: "too_many" };
  }
  for (const photo of photos) {
    if (!isAllowedLeadPhotoMime(photo.mimeType)) {
      return { ok: false, reason: "non_image" };
    }
    if (
      !Number.isFinite(photo.byteLength) ||
      photo.byteLength < 1 ||
      photo.byteLength > LEAD_PHOTO_MAX_BYTES
    ) {
      return { ok: false, reason: "too_large" };
    }
  }
  return { ok: true };
}

/** Object key: `{org_id}/{lead_id}/{file_id}.{ext}` inside the lead-photos bucket. */
export function buildLeadPhotoObjectPath(
  orgId: string,
  leadId: string,
  fileId: string,
  mimeType: LeadPhotoAllowedMime | string,
): string {
  if (!isAllowedLeadPhotoMime(mimeType)) {
    throw new Error("unsupported lead photo mime type");
  }
  return `${orgId}/${leadId}/${fileId}.${MIME_TO_EXT[mimeType]}`;
}
