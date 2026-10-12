import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultModifiers } from "@lawnquoter/pricing-engine";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

import { loadHelpArticle } from "@/lib/help/load";
import { PricingStudio, type StudioRule, type StudioService } from "./pricing-studio";

const service: StudioService = {
  id: "svc",
  name: "Mowing",
  kind: "mowing",
  description: null,
  active: true,
  openQuotes: 0,
  windowStart: null,
  windowEnd: null,
  warnDate: null,
  minimumPrice: null,
};

const rule: StudioRule = {
  id: "rule",
  serviceId: "svc",
  name: "Price tiers",
  config: {
    type: "tier_matrix",
    quantityKey: "turf_sqft",
    rows: [{ upTo: 5000, price: 40, hours: 0.5, cost: 18 }],
  },
};

function studio(tab: string) {
  return renderToStaticMarkup(
    createElement(PricingStudio, {
      priceListId: "list",
      services: [service],
      rules: [rule],
      modifiers: defaultModifiers(),
      canEdit: true,
      initialServiceId: "svc",
      initialTab: tab,
    }),
  );
}

describe("pricing page help", () => {
  it("explains price list units on the tier table", () => {
    const html = studio("tiers");
    expect(html).toContain("Help for price list units");
    expect(html).toContain("Measured quantity");
    expect(html).toContain("sq ft");
  });

  it("explains the service minimum on the main pricing page", () => {
    const html = studio("details");
    expect(html).toContain("Help for the service minimum");
    expect(html).toContain("Minimum for this service");
  });

  it("links those tips to headings in the pricing article", () => {
    const headings = loadHelpArticle("pricing")?.headings.map((heading) => heading.id) ?? [];
    expect(headings).toContain("units-on-the-price-list");
    expect(headings).toContain("minimum-and-the-first-cut");
  });
});
