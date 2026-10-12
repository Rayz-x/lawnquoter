import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Polygon } from "@lawnquoter/shared";

vi.mock("./reveal-quote", () => ({ revealInstantQuote: vi.fn(async () => null) }));
vi.mock("./load-map", () => ({ loadInstantQuoteMap: vi.fn(async () => null) }));
vi.mock("./start-deposit", () => ({ startInstantQuoteDeposit: vi.fn(async () => ({ ok: false, reason: "not_connected" })) }));
vi.mock("@/components/map/measure-map", () => ({
  MeasureMap: (props: { mode: string }) => createElement("div", { "data-mode": props.mode }),
}));

import { InstantQuoteMeasureStep, InstantQuoteSummary, InstantQuoteWidget } from "./instant-quote-widget";

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
        depositPaid: false,
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

    const payable = renderToStaticMarkup(
      createElement(InstantQuoteSummary, {
        offer: { low: 88, high: 118, statedMinimum: 50, confirm: "We'll confirm within 24 hours" },
        depositConnected: true,
        leadId: "lead-1",
        onDeposit: () => undefined,
      }),
    );
    expect(payable).toContain("Pay a deposit to lock this range.");
    expect(payable).not.toContain("STRIPE_SECRET_KEY");
  });

  it("confirms a paid deposit", () => {
    const html = renderToStaticMarkup(
      createElement(InstantQuoteWidget, {
        slug: "acme-lawn",
        services: ["Mowing"],
        serviceAreaZips: ["37064"],
        initialUtm: utm,
        depositConnected: true,
        depositPaid: true,
      }),
    );
    expect(html).toContain("Deposit received");
    expect(html).toContain("confirm within 24 hours");
  });

  it("starts from the lot on the map and offers length times width only when the lot is missing", () => {
    const lot: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-86.8, 36.1],
          [-86.8, 36.101],
          [-86.799, 36.101],
          [-86.799, 36.1],
          [-86.8, 36.1],
        ],
      ],
    };
    const blank = {
      trace: null,
      lengthFt: "",
      widthFt: "",
      onTrace: () => undefined,
      onLength: () => undefined,
      onWidth: () => undefined,
      onUse: () => undefined,
    };
    const prefill = renderToStaticMarkup(
      createElement(InstantQuoteMeasureStep, {
        ...blank,
        map: { location: null, parcel: lot, parcelSource: "regrid", footprint: null, footprintSource: null },
      }),
    );
    expect(prefill).toContain('data-mode="polygon"');
    expect(prefill).toContain("Lot minus the house");
    expect(prefill).toContain("107,534");
    expect(prefill).not.toContain("Length (ft)");

    const fallback = renderToStaticMarkup(
      createElement(InstantQuoteMeasureStep, {
        ...blank,
        map: { location: null, parcel: null, parcelSource: null, footprint: null, footprintSource: null },
      }),
    );
    expect(fallback).toContain('data-mode="polygon"');
    expect(fallback).toContain("Length (ft)");
    expect(fallback).toContain("Width (ft)");
  });
});
