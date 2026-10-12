import { describe, expect, it } from "vitest";
import { loadHelpArticle, loadHelpArticles } from "./load";

describe("loadHelpArticle", () => {
  it("reads the using-help article and keeps its heading anchors", () => {
    const article = loadHelpArticle("using-help");
    expect(article?.title).toBe("Using help");
    expect(article?.headings.map((heading) => heading.id)).toEqual(["find-a-topic", "open-a-section", "ask-from-a-field"]);
  });

  it("loads the setup articles with the anchors later screens link to", () => {
    const slugs = loadHelpArticles().map((article) => article.slug);
    expect(slugs).toEqual(expect.arrayContaining(["getting-started", "team-and-roles", "plan-and-billing", "export-data"]));
    expect(loadHelpArticle("getting-started")?.headings.map((heading) => heading.id)).toContain("service-area");
    expect(loadHelpArticle("plan-and-billing")?.headings.map((heading) => heading.id)).toContain("when-billing-stays-off");
    expect(loadHelpArticle("export-data")?.headings.map((heading) => heading.id)).toEqual(["download-the-zip", "what-is-in-the-file"]);
    expect(loadHelpArticle("customers")?.headings.map((heading) => heading.id)).toContain("duplicates");
    expect(loadHelpArticle("properties")?.headings.map((heading) => heading.id)).toContain("what-changes-the-price");
  });
});
