import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./reveal-quote", () => ({ revealInstantQuote: vi.fn(async () => null) }));

import { InstantQuoteSummary, InstantQuoteWidget } from "./instant-quote-widget";

const utm = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
};

describe("InstantQuoteWidget", () => {
  it("starts on the address step and does not show a price", () => {
    const html = renderToStaticMarkup(
      createElement(InstantQuoteWidget, {
        slug: "acme-lawn",
        services: ["Mowing"],
        serviceAreaZips: ["37064"],
        initialUtm: utm,
        depositConnected: false,
      }),
    );
    expect(html).toContain("Address");
    expect(html).not.toMatch(/\$\d/);
  });

  it("shows the range, stated minimum, and 24 hour confirm only when an offer exists", () => {
    const hidden = renderToStaticMarkup(
      createElement(InstantQuoteSummary, { offer: null, depositConnected: false }),
    );
    expect(hidden).toBe("");

    const html = renderToStaticMarkup(
      createElement(InstantQuoteSummary, {
        offer: { low: 88, high: 118, statedMinimum: 50, confirm: "We'll confirm within 24 hours" },
        depositConnected: false,
      }),
    );
    expect(html).toContain("$88.00");
    expect(html).toContain("$118.00");
    expect(html).toContain("$50.00");
    expect(html).toContain("confirm within 24 hours");
    expect(html).toContain("Not connected — add a STRIPE_SECRET_KEY to enable");
  });
});
