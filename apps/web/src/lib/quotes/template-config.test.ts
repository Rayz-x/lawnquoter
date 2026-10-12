import { describe, expect, it } from "vitest";
import { quoteTemplateConfig, readQuoteTemplateConfig } from "./template-config";

describe("quote template config", () => {
  it("keeps each line under its section for a service template", () => {
    const config = quoteTemplateConfig({
      sections: [
        { id: "s1", title: "Included" },
        { id: "s2", title: "Optional" },
      ],
      items: [
        { section_id: "s1", name: "Weekly mowing", description: "Front and back", state: "included", qty: 1, unit: "visit", price: 40, sort: 0 },
        { section_id: "s2", name: "Aeration", description: null, state: "optional", qty: "1", unit: "job", price: "90", sort: 1 },
      ],
    });
    expect(config.lines).toEqual([
      { section: "Included", name: "Weekly mowing", description: "Front and back", state: "included", qty: 1, unit: "visit", price: 40 },
      { section: "Optional", name: "Aeration", description: null, state: "optional", qty: 1, unit: "job", price: 90 },
    ]);
    expect(readQuoteTemplateConfig(config)?.lines).toEqual(config.lines);
  });

  it("rejects a template that is not a list of named lines", () => {
    expect(readQuoteTemplateConfig(null)).toBeNull();
    expect(readQuoteTemplateConfig({ lines: [{ name: "" }] })).toBeNull();
    expect(readQuoteTemplateConfig({ lines: [{ section: "Work", name: "Mow", state: "included", qty: 1, unit: "visit", price: 10 }] })?.lines[0]?.description).toBeNull();
  });
});
