import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuoteVersionDiffCard } from "@/components/quotes/version-diff";
import { diffQuoteVersions, quoteDiffLines } from "./version-diff";

const sections = [
  { id: "sec-1", title: "Included" },
  { id: "sec-2", title: "Optional" },
];

describe("diffQuoteVersions", () => {
  it("reports a price change, an added line, and a removed line", () => {
    const before = quoteDiffLines({
      sections,
      items: [
        { section_id: "sec-1", name: "Weekly mowing", qty: 1, unit: "visit", price: 40, state: "included", sort: 0 },
        { section_id: "sec-2", name: "Cleanup", qty: 1, unit: "job", price: 30, state: "optional", sort: 1 },
      ],
    });
    const after = quoteDiffLines({
      sections,
      items: [
        { section_id: "sec-1", name: "Weekly mowing", qty: "1", unit: "visit", price: "45.00", state: "included", sort: 0 },
        { section_id: "sec-1", name: "Edging", qty: 1, unit: "job", price: 20, state: "included", sort: 1 },
      ],
    });
    const changes = diffQuoteVersions(before, after);
    expect(changes.map((change) => change.kind)).toEqual(["changed", "removed", "added"]);
    expect(changes[0]).toMatchObject({ before: { price: 40 }, after: { price: 45 } });
    expect(changes[1]).toMatchObject({ kind: "removed", line: { name: "Cleanup" } });
    expect(changes[2]).toMatchObject({ kind: "added", line: { name: "Edging", section: "Included" } });
  });

  it("treats two lines with the same name as separate rows", () => {
    const before = quoteDiffLines({
      sections,
      items: [
        { section_id: "sec-1", name: "Bed", qty: 1, unit: "each", price: 10, state: "included", sort: 0 },
        { section_id: "sec-1", name: "Bed", qty: 1, unit: "each", price: 12, state: "included", sort: 1 },
      ],
    });
    const after = quoteDiffLines({
      sections,
      items: [
        { section_id: "sec-1", name: "Bed", qty: 1, unit: "each", price: 10, state: "included", sort: 0 },
        { section_id: "sec-1", name: "Bed", qty: 1, unit: "each", price: 18, state: "included", sort: 1 },
      ],
    });
    const changes = diffQuoteVersions(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "changed", before: { price: 12 }, after: { price: 18 } });
  });
});

describe("QuoteVersionDiffCard", () => {
  it("shows the previous price and the new price", () => {
    const before = quoteDiffLines({
      sections,
      items: [{ section_id: "sec-1", name: "Weekly mowing", qty: 1, unit: "visit", price: 40, state: "included", sort: 0 }],
    });
    const after = quoteDiffLines({
      sections,
      items: [{ section_id: "sec-1", name: "Weekly mowing", qty: 1, unit: "visit", price: 45, state: "included", sort: 0 }],
    });
    const markup = renderToStaticMarkup(
      createElement(QuoteVersionDiffCard, { fromVersion: 1, changes: diffQuoteVersions(before, after) }),
    );
    expect(markup).toContain("Changes from version 1");
    expect(markup).toContain("Weekly mowing");
    expect(markup).toContain("$40");
    expect(markup).toContain("$45");
  });
});
