import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPublicLeadForm = vi.hoisted(() =>
  vi.fn(async (): Promise<{
    orgId: string;
    orgName: string;
    slug: string;
    services: string[];
    consentText: string;
    responseTargetMinutes: number;
  } | null> => ({
    orgId: "org-1",
    orgName: "Acme Lawn",
    slug: "acme-lawn",
    services: ["Mowing"],
    consentText: "SMS consent line",
    responseTargetMinutes: 60,
  })),
);

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
}));

vi.mock("@/lib/leads/load-public-form", () => ({ loadPublicLeadForm }));
vi.mock("next/navigation", () => ({ notFound }));

vi.mock("./request-quote-form", () => ({
  RequestQuoteForm: (props: { orgName: string }) =>
    createElement("div", { "data-testid": "form" }, props.orgName),
}));

import HostedQuoteRequestPage from "./page";

describe("HostedQuoteRequestPage", () => {
  beforeEach(() => {
    loadPublicLeadForm.mockClear();
    notFound.mockClear();
  });

  it("renders brand + form with no price copy", async () => {
    const element = await HostedQuoteRequestPage({ params: Promise.resolve({ slug: "acme-lawn" }) });
    const html = renderToStaticMarkup(element as ReactNode);
    expect(html).toContain("Acme Lawn");
    expect(html).toContain("Privacy notice");
    expect(html.toLowerCase()).not.toMatch(/\$\d/);
    expect(html.toLowerCase()).not.toContain("estimate");
  });

  it("404s for unknown slug", async () => {
    loadPublicLeadForm.mockResolvedValueOnce(null);
    await expect(
      HostedQuoteRequestPage({ params: Promise.resolve({ slug: "missing" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
