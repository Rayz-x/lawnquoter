import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadInstantQuotePage = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));

vi.mock("@/lib/leads/load-public-form", () => ({ loadInstantQuotePage }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("./reveal-quote", () => ({ revealInstantQuote: vi.fn(async () => null) }));

import InstantQuotePage from "./page";

const org = {
  orgId: "org-1",
  orgName: "Acme Lawn",
  slug: "acme-lawn",
  services: ["Mowing"],
  consentText: "SMS consent line",
  responseTargetMinutes: 60,
  config: { serviceAreaZips: ["37064"], ratePerSqft: 0.01, statedMinimum: 50 },
};

describe("InstantQuotePage", () => {
  beforeEach(() => {
    loadInstantQuotePage.mockReset();
    loadInstantQuotePage.mockResolvedValue(org);
    notFound.mockClear();
  });

  it("renders the address step with no price", async () => {
    const html = renderToStaticMarkup(
      (await InstantQuotePage({
        params: Promise.resolve({ slug: "acme-lawn" }),
        searchParams: Promise.resolve({ utm_source: "facebook" }),
      })) as ReactNode,
    );
    expect(html).toContain("Acme Lawn");
    expect(html).toContain("Address");
    expect(html).not.toMatch(/\$\d/);
  });

  it("404s for an unknown company", async () => {
    loadInstantQuotePage.mockResolvedValueOnce(null);
    await expect(
      InstantQuotePage({ params: Promise.resolve({ slug: "missing" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
