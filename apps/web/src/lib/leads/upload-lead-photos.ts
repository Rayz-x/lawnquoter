import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEAD_PHOTO_MAX_COUNT,
  LEAD_PHOTOS_BUCKET,
  buildLeadPhotoObjectPath,
  isAllowedLeadPhotoMime,
  validateLeadPhotoCandidates,
  type LeadPhotoFile,
} from "./lead-photos";

type UntypedFrom = {
  select: (columns: string) => UntypedFilter;
  update: (values: Record<string, unknown>) => UntypedFilter;
};

type UntypedFilter = {
  eq: (column: string, value: string) => UntypedFilter;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  then: (
    onfulfilled?: (value: {
      data?: Record<string, unknown>[] | null;
      error: { message: string } | null;
    }) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

function asBody(body: LeadPhotoFile["body"]): Blob | ArrayBuffer | Buffer {
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  return body;
}

/**
 * Uploads validated lead photos with the service-role client and writes
 * `lead_requests.photo_paths`. Call only after Turnstile has passed.
 */
export async function uploadLeadPhotos(
  admin: SupabaseClient,
  args: { orgId: string; leadId: string; photos: LeadPhotoFile[] },
): Promise<string[]> {
  const check = validateLeadPhotoCandidates(args.photos);
  if (!check.ok) {
    throw new Error(`lead photos rejected: ${check.reason}`);
  }
  if (args.photos.length === 0) return [];

  const db = admin as unknown as { from: (table: string) => UntypedFrom };
  const existing = (await db
    .from("lead_requests")
    .select("id, org_id, photo_paths")
    .eq("id", args.leadId)
    .eq("org_id", args.orgId)
    .maybeSingle()) as {
    data: { id: string; org_id: string; photo_paths: string[] | null } | null;
    error: { message: string } | null;
  };
  if (existing.error || !existing.data) {
    throw new Error(existing.error?.message ?? "lead missing for photo upload");
  }

  const prior = Array.isArray(existing.data.photo_paths) ? existing.data.photo_paths : [];
  const room = LEAD_PHOTO_MAX_COUNT - prior.length;
  if (room <= 0) return prior;

  const toUpload = args.photos.slice(0, room);
  const uploaded: string[] = [];

  for (const photo of toUpload) {
    if (!isAllowedLeadPhotoMime(photo.mimeType)) {
      throw new Error("unsupported lead photo mime type");
    }
    const path = buildLeadPhotoObjectPath(args.orgId, args.leadId, randomUUID(), photo.mimeType);
    const { error } = await admin.storage.from(LEAD_PHOTOS_BUCKET).upload(path, asBody(photo.body), {
      contentType: photo.mimeType,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    uploaded.push(path);
  }

  const photoPaths = [...prior, ...uploaded].slice(0, LEAD_PHOTO_MAX_COUNT);
  const updateResult = (await db
    .from("lead_requests")
    .update({ photo_paths: photoPaths })
    .eq("id", args.leadId)
    .eq("org_id", args.orgId)) as { error: { message: string } | null };
  if (updateResult.error) throw new Error(updateResult.error.message);

  return photoPaths;
}
