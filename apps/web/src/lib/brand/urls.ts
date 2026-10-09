const ORG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bucket object key `{orgId}/...`. Absolute and root-relative URLs are rejected. */
export function brandingObjectPath(path: string | null | undefined, orgId: string): string | null {
  if (!path || !orgId || path.length > 512) return null;
  if (path !== path.trim()) return null;
  if (/[\s\\]/.test(path) || path.includes("..") || path.includes("://") || path.startsWith("/") || path.startsWith("//")) {
    return null;
  }
  const slash = path.indexOf("/");
  if (slash <= 0) return null;
  const prefix = path.slice(0, slash);
  const rest = path.slice(slash + 1);
  if (!ORG_ID.test(prefix) || !ORG_ID.test(orgId)) return null;
  if (prefix.toLowerCase() !== orgId.toLowerCase()) return null;
  if (!rest || rest.includes("://") || rest.startsWith("/")) return null;
  return path;
}

export function brandingPathOrgId(path: string | null | undefined): string | null {
  if (!path) return null;
  const prefix = path.split("/")[0] ?? "";
  return ORG_ID.test(prefix) ? prefix : null;
}

function projectStorageUrl(objectPath: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  let project: URL;
  try {
    project = new URL(base);
  } catch {
    return null;
  }
  if (project.protocol !== "http:" && project.protocol !== "https:") return null;
  const encoded = objectPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const root = `${project.origin}${project.pathname.replace(/\/$/, "")}`;
  return `${root}/storage/v1/object/public/org-branding/${encoded}`;
}

/** Public object URL for an org-scoped bucket path. Anything else stays unresolved. */
export function brandingAssetUrl(path: string | null | undefined, orgId?: string | null): string | null {
  const owner = orgId || brandingPathOrgId(path);
  if (!owner) return null;
  const objectPath = brandingObjectPath(path, owner);
  if (!objectPath) return null;
  return projectStorageUrl(objectPath);
}

export function isHttpUrl(value: string): boolean {
  if (!value || value.length > 200) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
