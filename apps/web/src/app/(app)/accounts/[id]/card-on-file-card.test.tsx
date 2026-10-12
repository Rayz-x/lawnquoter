import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/entry", () => ({
  SectionCard: ({ title, children }: { title: string; children?: React.ReactNode }) =>
    createElement("section", null, createElement("h2", null, title), children),
  ToggleRow: ({ label }: { label: string }) => createElement("div", null, label),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode }) => createElement("button", props, children),
}));
vi.mock("@/components/ui/spinner", () => ({ Spinner: () => null }));
vi.mock("./card-on-file-actions", () => ({ startCardOnFile: vi.fn(), setAccountAutoCharge: vi.fn() }));

import { CardOnFileCard } from "./card-on-file-card";

describe("CardOnFileCard", () => {
  it("hides Add card until Stripe is connected", () => {
    const html = renderToStaticMarkup(
      createElement(CardOnFileCard, {
        accountId: "acct-1",
        stripeKey: false,
        connectReady: false,
        methods: [],
        notice: null,
      }),
    );
    expect(html).toContain("Not connected - add a Stripe key to enable.");
    expect(html).not.toContain("Add card");
    expect(html).not.toContain("Charge this card after each visit");
  });

  it("offers auto-charge once Stripe is connected", () => {
    const html = renderToStaticMarkup(
      createElement(CardOnFileCard, {
        accountId: "acct-1",
        stripeKey: true,
        connectReady: true,
        methods: [],
        notice: null,
        autoCharge: false,
      }),
    );
    expect(html).toContain("Charge this card after each visit");
    expect(html).toContain("Add card");
  });
});
