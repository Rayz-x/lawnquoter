/** Storage path or absolute URL → a URL an `<img>` can load. Paths stay unresolved until the public origin is known. */
export function brandingAssetUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("https://") || pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("/")) return pathOrUrl;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  const encoded = pathOrUrl
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${base}/storage/v1/object/public/org-branding/${encoded}`;
}
