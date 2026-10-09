import { brandingAssetUrl, brandingObjectPath } from "./urls";

export const RASTER_FETCH_TIMEOUT_MS = 3_000;
export const RASTER_BYTE_CAP = 2 * 1024 * 1024;

function isPngOrJpeg(bytes: Buffer): boolean {
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  return png || jpeg;
}

/**
 * Read an org logo raster from this project's public storage bucket.
 * The path must be `{orgId}/...`. Absolute URLs are never fetched.
 */
export async function loadBrandingRaster(path: string | null | undefined, orgId: string): Promise<Buffer | null> {
  const objectPath = brandingObjectPath(path, orgId);
  const url = objectPath ? brandingAssetUrl(objectPath, orgId) : null;
  if (!objectPath || !url) return null;
  let project: URL;
  let target: URL;
  try {
    project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.origin !== project.origin || !target.pathname.includes("/storage/v1/object/public/org-branding/")) {
    return null;
  }
  try {
    const response = await fetch(target.href, {
      redirect: "error",
      signal: AbortSignal.timeout(RASTER_FETCH_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) return null;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > RASTER_BYTE_CAP) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > RASTER_BYTE_CAP) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    return isPngOrJpeg(bytes) ? bytes : null;
  } catch {
    return null;
  }
}
