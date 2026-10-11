/** Pure builders for the hosted quote form link, button, and iframe (L14). */

export function hostedQuoteFormUrl(origin: string, slug: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/r/${slug}`;
}

/** Button HTML for a company website. Includes default UTM tags for attribution. */
export function quoteButtonSnippet(
  origin: string,
  slug: string,
  options?: { label?: string },
): string {
  const label = options?.label?.trim() || "Get a quote";
  const href = `${hostedQuoteFormUrl(origin, slug)}?utm_medium=button&utm_source=website`;
  return `<a href="${href}">${label}</a>`;
}

/** iframe HTML that loads the hosted form. Includes default UTM tags for attribution. */
export function quoteIframeEmbed(origin: string, slug: string): string {
  const src = `${hostedQuoteFormUrl(origin, slug)}?utm_medium=embed&utm_source=website`;
  return `<iframe src="${src}" title="Request a quote" style="width:100%;min-height:720px;border:0;" loading="lazy"></iframe>`;
}

/** Prefer the non-guessable lead_form_slug; fall back to the company URL handle. */
export function leadFormSlugFromOrg(org: { slug: string; settings: unknown }): string {
  const settings = org.settings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const raw = (settings as Record<string, unknown>).lead_form_slug;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) return trimmed;
    }
  }
  return org.slug;
}
