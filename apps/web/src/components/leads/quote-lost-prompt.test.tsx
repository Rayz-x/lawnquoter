import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/leads/actions", () => ({
  markLeadLostAction: vi.fn(),
  reopenLeadAction: vi.fn(),
}));

import { QuoteLostPrompt } from "./quote-lost-prompt";

describe("QuoteLostPrompt", () => {
  it("shows the lost prompt for an expired quote linked to a lead", () => {
    const html = renderToStaticMarkup(
      createElement(QuoteLostPrompt, {
        quoteId: "q-1",
        quoteStatus: "expired",
        leadId: "lead-1",
        leadStatus: "quoted",
      }),
    );
    expect(html).toContain('data-testid="quote-lost-prompt"');
    expect(html).toContain("Mark this lead lost?");
    expect(html).toContain("expired");
    expect(html).toContain("Add lost reason");
  });

  it("hides when the quote is not declined or expired", () => {
    const html = renderToStaticMarkup(
      createElement(QuoteLostPrompt, {
        quoteId: "q-1",
        quoteStatus: "sent",
        leadId: "lead-1",
        leadStatus: "quoted",
      }),
    );
    expect(html).toBe("");
  });
});
