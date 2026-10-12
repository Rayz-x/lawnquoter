import { describe, expect, it } from "vitest";
import { matchingHeadings, parseHelpArticle, searchHelp } from "./parse";

const SOURCE = `---
title: Using help
section: Setup
summary: Search the library and open an article.
order: 1
---

## Find a topic

Type a few words in the search box.

## Find a topic

The second heading keeps its own link.

### Late fees

A late fee is a separate bill.
`;

describe("parseHelpArticle", () => {
  it("gives each heading a stable anchor and keeps duplicates distinct", () => {
    const article = parseHelpArticle("using-help", SOURCE);
    expect(article.title).toBe("Using help");
    expect(article.section).toBe("Setup");
    expect(article.order).toBe(1);
    expect(article.headings.map((heading) => heading.id)).toEqual(["find-a-topic", "find-a-topic-2", "late-fees"]);
    expect(article.text).toContain("search box");
    expect(article.text).toContain("separate bill");
  });
});

describe("searchHelp", () => {
  const article = parseHelpArticle("using-help", SOURCE);

  it("returns every article when the query is blank", () => {
    expect(searchHelp([article], "  ").map((hit) => hit.slug)).toEqual(["using-help"]);
  });

  it("matches a heading and a sentence in the body", () => {
    expect(searchHelp([article], "late").map((hit) => hit.slug)).toEqual(["using-help"]);
    expect(matchingHeadings(article, "late").map((heading) => heading.id)).toEqual(["late-fees"]);
    expect(searchHelp([article], "separate bill").map((hit) => hit.slug)).toEqual(["using-help"]);
    expect(searchHelp([article], "snow plow")).toEqual([]);
  });
});
