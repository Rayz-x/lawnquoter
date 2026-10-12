import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/entry", () => ({
  SectionCard: ({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) =>
    createElement("section", null, createElement("h2", null, title), description ? createElement("p", null, description) : null, children),
}));

import { CardOnFileCard } from "./card-on-file-card";

describe("CardOnFileCard", () => {
  it("shows the Stripe key message when payments are off", () => {
    const html = renderToStaticMarkup(
      createElement(CardOnFileCard, { stripeKey: false, connectReady: false, methods: [] }),
    );
    expect(html).toContain("Not connected - add a Stripe key to enable.");
    expect(html).toContain("No card on file yet.");
  });
});
