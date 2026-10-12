import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { leadConnectorStates } from "@/lib/leads/inbound";

vi.mock("@/components/entry", () => ({
  SectionCard: ({ title, children }: { title: string; children?: React.ReactNode }) =>
    createElement("section", null, createElement("h2", null, title), children),
}));

import { LeadConnectorsCard } from "./lead-connectors-card";

describe("LeadConnectorsCard", () => {
  it("shows every source as not connected when no keys are set", () => {
    const html = renderToStaticMarkup(
      createElement(LeadConnectorsCard, { isOwner: true, states: leadConnectorStates({}) }),
    );
    expect(html).toContain("Lead connectors");
    expect(html).toContain("Thumbtack");
    expect(html).toContain("Not connected — add THUMBTACK_WEBHOOK_SECRET to enable");
    expect(html).toContain("Zapier");
    expect(html).toContain("Not connected — add GOOGLE_LSA_WEBHOOK_SECRET to enable");
  });

  it("hides the card from non-owners", () => {
    const html = renderToStaticMarkup(createElement(LeadConnectorsCard, { isOwner: false, states: [] }));
    expect(html).toBe("");
  });
});
