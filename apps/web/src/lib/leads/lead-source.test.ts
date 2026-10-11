import { describe, expect, it } from "vitest";
import {
  LEAD_SOURCES,
  WEBSITE_FORM_SOURCE,
  formatLeadSource,
  parseLeadSource,
} from "./lead-source";

describe("LEAD_SOURCES", () => {
  it("lists user-selectable values and excludes Website form", () => {
    expect(LEAD_SOURCES).toEqual([
      "Google",
      "Referral",
      "Door hanger",
      "Yard sign",
      "Repeat",
      "Other",
    ]);
    expect(LEAD_SOURCES).not.toContain(WEBSITE_FORM_SOURCE);
  });
});

describe("parseLeadSource", () => {
  it("rejects Other without text", () => {
    expect(parseLeadSource("Other", "")).toEqual({
      ok: false,
      error: "Describe the lead source when Other is selected.",
    });
    expect(parseLeadSource("Other", "   ")).toEqual({
      ok: false,
      error: "Describe the lead source when Other is selected.",
    });
  });

  it("accepts Other with trimmed free text", () => {
    expect(parseLeadSource("Other", "  Nextdoor  ")).toEqual({
      ok: true,
      lead_source: "Other",
      lead_source_other: "Nextdoor",
    });
  });

  it("clears other text for non-Other picklist values", () => {
    expect(parseLeadSource("Google", "leftover")).toEqual({
      ok: true,
      lead_source: "Google",
      lead_source_other: null,
    });
  });

  it("treats empty source as null", () => {
    expect(parseLeadSource("", "ignored")).toEqual({
      ok: true,
      lead_source: null,
      lead_source_other: null,
    });
  });

  it("rejects Website form from user input", () => {
    expect(parseLeadSource(WEBSITE_FORM_SOURCE, "")).toEqual({
      ok: false,
      error: "Website form lead source can only be set by the system.",
    });
  });

  it("rejects unknown free-text sources", () => {
    expect(parseLeadSource("Nextdoor", "")).toEqual({
      ok: false,
      error: "Choose a lead source from the list.",
    });
  });
});

describe("formatLeadSource", () => {
  it("appends other text for Other", () => {
    expect(formatLeadSource("Other", "Flyer")).toBe("Other — Flyer");
    expect(formatLeadSource("Google", null)).toBe("Google");
    expect(formatLeadSource(null, null)).toBeNull();
  });
});
