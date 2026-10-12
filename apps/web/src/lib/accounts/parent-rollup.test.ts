import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParentRollupCard } from "@/components/accounts/parent-rollup";
import { rollupParentSites } from "./parent-rollup";

describe("rollupParentSites", () => {
  it("adds open quotes, issued invoices, properties, and active jobs across the parent and its sites", () => {
    const rollup = rollupParentSites({
      accounts: [
        { id: "parent", name: "Maple HOA" },
        { id: "phase-2", name: "Maple Phase 2" },
      ],
      quotes: [
        { account_id: "parent", status: "sent" },
        { account_id: "parent", status: "accepted" },
        { account_id: "phase-2", status: "draft" },
        { account_id: "phase-2", status: "viewed" },
      ],
      invoices: [
        { account_id: "parent", status: "issued", total_cents: 15000 },
        { account_id: "parent", status: "paid", total_cents: 9000 },
        { account_id: "phase-2", status: "issued", total_cents: 4000 },
        { account_id: "phase-2", status: "void", total_cents: 1000 },
      ],
      properties: [
        { id: "p1", account_id: "parent" },
        { id: "p2", account_id: "phase-2" },
        { id: "p3", account_id: "phase-2" },
      ],
      jobs: [
        { property_id: "p1", status: "scheduled" },
        { property_id: "p2", status: "cancelled" },
        { property_id: "p3", status: "completed" },
      ],
    });

    expect(rollup.totals).toEqual({
      sites: 2,
      openQuotes: 3,
      issuedCents: 19000,
      properties: 3,
      jobs: 2,
    });
    expect(rollup.sites.map((site) => [site.name, site.openQuotes, site.issuedCents, site.jobs])).toEqual([
      ["Maple HOA", 1, 15000, 1],
      ["Maple Phase 2", 2, 4000, 1],
    ]);
  });
});

describe("ParentRollupCard", () => {
  it("shows the combined issued amount and a link to each site", () => {
    const markup = renderToStaticMarkup(
      createElement(ParentRollupCard, {
        rollup: rollupParentSites({
          accounts: [
            { id: "parent", name: "Maple HOA" },
            { id: "phase-2", name: "Maple Phase 2" },
          ],
          quotes: [{ account_id: "phase-2", status: "sent" }],
          invoices: [{ account_id: "phase-2", status: "issued", total_cents: 4000 }],
          properties: [],
          jobs: [],
        }),
      }),
    );
    expect(markup).toContain("2 accounts");
    expect(markup).toContain("$40.00");
    expect(markup).toContain('href="/accounts/phase-2"');
    expect(markup).toContain("1 open quote");
  });
});
