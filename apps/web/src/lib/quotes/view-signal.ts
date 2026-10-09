/**
 * A quote is marked viewed only after this client signal, not when the link is fetched.
 *
 * Mail scanners and link previewers (for example Microsoft Defender Safe Links)
 * GET the URL at delivery time, often without a visible, focused document and
 * without running the page as an interactive session. `quote_public` is a
 * stable read and does not write. The browser posts `/q/[token]/view` only when:
 *
 * - the visitor clicks, taps, or types (debounced), or
 * - the page stays visible and focused long enough to read, and
 * - `navigator.webdriver` is false, and
 * - the request is not a prefetch or preview.
 *
 * The first of those signals wins. The RPC itself only moves `sent` to `viewed`
 * and keeps the original `viewed_at`.
 */
export const VIEW_INTERACTION_DEBOUNCE_MS = 300;
export const VIEW_DWELL_MS = 8000;

export function isPreviewRequest(headers: Headers): boolean {
  const purpose = [headers.get("purpose"), headers.get("sec-purpose"), headers.get("sec-fetch-purpose")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return purpose.includes("prefetch") || purpose.includes("preview");
}

export function viewSignalAllowed(input: {
  visibility: string;
  hasFocus: boolean;
  webdriver: boolean;
}): boolean {
  if (input.webdriver) return false;
  if (input.visibility !== "visible") return false;
  if (!input.hasFocus) return false;
  return true;
}
