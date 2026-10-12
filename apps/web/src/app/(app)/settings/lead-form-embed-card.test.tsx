import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/entry", () => ({
  SectionCard: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: string;
    children?: React.ReactNode;
  }) =>
    createElement(
      "section",
      { "data-title": title },
      createElement("h2", null, title),
      description ? createElement("p", null, description) : null,
      children,
    ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) => createElement("textarea", props),
}));

import { LeadFormEmbedCard } from "./lead-form-embed-card";

describe("LeadFormEmbedCard", () => {
  const props = {
    origin: "https://app.lawnquoter.com",
    slug: "acme-lawn",
  };

  it("renders hosted link, button snippet, and iframe for owners", () => {
    const html = renderToStaticMarkup(createElement(LeadFormEmbedCard, { ...props, isOwner: true }));
    expect(html).toContain("Hosted form");
    expect(html).toContain("/r/acme-lawn");
    expect(html).toContain("Button snippet");
    expect(html).toContain("Embed snippet");
    expect(html).toContain("/w/acme-lawn");
    expect(html).toContain("Instant quote embed");
    expect(html).toContain("&lt;iframe");
    expect(html).toContain("acme-lawn");
  });

  it("does not render the settings card for non-owners", () => {
    const html = renderToStaticMarkup(createElement(LeadFormEmbedCard, { ...props, isOwner: false }));
    expect(html).toBe("");
  });
});
