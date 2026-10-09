const FALLBACK = "/dashboard";

/**
 * Same-origin path for post-login navigation.
 * Allows a single leading slash, including a query string.
 * Rejects protocol-relative URLs (`//host`) and backslashes (`/\host`).
 */
export function safeNext(next: string | null | undefined, fallback = FALLBACK): string {
  if (typeof next !== "string") return fallback;
  const value = next.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  if (value.includes("\0")) return fallback;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || decoded.includes("\0")) {
    return fallback;
  }
  return value;
}
