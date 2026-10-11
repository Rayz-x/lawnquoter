import { describe, expect, it } from "vitest";
import {
  hostedQuoteFormUrl,
  leadFormSlugFromOrg,
  quoteButtonSnippet,
  quoteIframeEmbed,
} from "./embed-snippets";

describe("lead form embed snippets", () => {
  const origin = "https://app.lawnquoter.com";
  const slug = "acme-lawn";

  it("hosted URL includes the company slug", () => {
    expect(hostedQuoteFormUrl(origin, slug)).toBe("https://app.lawnquoter.com/r/acme-lawn");
  });

  it("button snippet contains the company slug", () => {
    const snippet = quoteButtonSnippet(origin, slug);
    expect(snippet).toContain(slug);
    expect(snippet).toContain("/r/acme-lawn");
    expect(snippet).toMatch(/utm_medium=button/);
    expect(snippet).toMatch(/utm_source=website/);
  });

  it("iframe embed contains the company slug", () => {
    const snippet = quoteIframeEmbed(origin, slug);
    expect(snippet).toContain(slug);
    expect(snippet).toContain("/r/acme-lawn");
    expect(snippet).toMatch(/utm_medium=embed/);
    expect(snippet).toMatch(/utm_source=website/);
  });

  it("strips a trailing slash from the origin", () => {
    expect(hostedQuoteFormUrl(`${origin}/`, slug)).toBe("https://app.lawnquoter.com/r/acme-lawn");
  });

  it("prefers lead_form_slug from org settings over org.slug", () => {
    expect(
      leadFormSlugFromOrg({
        slug: "org-handle",
        settings: { lead_form_slug: "secret-form" },
      }),
    ).toBe("secret-form");
  });

  it("falls back to org.slug when lead_form_slug is unset", () => {
    expect(leadFormSlugFromOrg({ slug: "org-handle", settings: {} })).toBe("org-handle");
  });
});
