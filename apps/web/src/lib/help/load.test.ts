import { describe, expect, it } from "vitest";
import { loadHelpArticle } from "./load";

describe("loadHelpArticle", () => {
  it("reads the using-help article and keeps its heading anchors", () => {
    const article = loadHelpArticle("using-help");
    expect(article?.title).toBe("Using help");
    expect(article?.headings.map((heading) => heading.id)).toEqual(["find-a-topic", "open-a-section", "ask-from-a-field"]);
  });
});
