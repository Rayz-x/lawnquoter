import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_CHECK_THRESHOLD,
  autoSiteCheckReasons,
  hasSiteCheck,
  mergeSiteCheckReasons,
  siteCheckReasonLabel,
  siteCheckReasonsSummary,
} from "./site-check";

describe("autoSiteCheckReasons", () => {
  it("flags low confidence under the default threshold", () => {
    expect(autoSiteCheckReasons({ confidence: 0.48 })).toEqual(["low_confidence"]);
  });

  it("does not auto-flag medium confidence", () => {
    expect(autoSiteCheckReasons({ confidence: 0.6 })).toEqual([]);
  });

  it("does not auto-flag high confidence", () => {
    expect(autoSiteCheckReasons({ confidence: 0.9 })).toEqual([]);
  });

  it("does not auto-flag when confidence is missing", () => {
    expect(autoSiteCheckReasons({ confidence: null })).toEqual([]);
    expect(autoSiteCheckReasons({})).toEqual([]);
  });

  it("uses the org threshold when provided", () => {
    expect(autoSiteCheckReasons({ confidence: 0.58, threshold: 0.6 })).toEqual(["low_confidence"]);
    expect(autoSiteCheckReasons({ confidence: 0.58, threshold: 0.55 })).toEqual([]);
  });

  it("exports the default threshold matching the low band", () => {
    expect(DEFAULT_SITE_CHECK_THRESHOLD).toBe(0.55);
  });
});

describe("mergeSiteCheckReasons", () => {
  it("adds manual without duplicating", () => {
    expect(mergeSiteCheckReasons(["low_confidence"], "manual")).toEqual(["low_confidence", "manual"]);
    expect(mergeSiteCheckReasons(["manual"], "manual")).toEqual(["manual"]);
  });

  it("removes manual when clearing the office flag", () => {
    expect(mergeSiteCheckReasons(["low_confidence", "manual"], null)).toEqual(["low_confidence"]);
  });
});

describe("site check copy", () => {
  it("summarizes reasons for the office line", () => {
    expect(siteCheckReasonsSummary(["low_confidence"])).toBe("Low measurement confidence");
    expect(siteCheckReasonsSummary(["low_confidence", "manual"])).toBe(
      "Low measurement confidence · Flagged by office",
    );
  });

  it("labels each known reason", () => {
    expect(siteCheckReasonLabel("low_confidence")).toBe("Low measurement confidence");
    expect(siteCheckReasonLabel("manual")).toBe("Flagged by office");
  });

  it("detects a flagged line", () => {
    expect(hasSiteCheck(["low_confidence"])).toBe(true);
    expect(hasSiteCheck([])).toBe(false);
  });
});
