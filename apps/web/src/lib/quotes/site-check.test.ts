import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_CHECK_THRESHOLD,
  SITE_CHECK_AFTER_ACCEPTANCE,
  SITE_CHECK_EXPLANATION_TITLE,
  SITE_CHECK_LINE_PILL,
  acceptUpToLabel,
  autoSiteCheckReasons,
  hasSiteCheck,
  mergeSiteCheckReasons,
  siteCheckCustomerBody,
  siteCheckCustomerSees,
  siteCheckReasonLabel,
  siteCheckReasonsSummary,
  siteCheckWhatHappensNext,
  youPayNoMoreThan,
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

  it("uses the shared after-acceptance due copy", () => {
    expect(SITE_CHECK_AFTER_ACCEPTANCE).toBe(
      "We'll confirm on site within 5 days of acceptance",
    );
  });
});

describe("siteCheckCustomerSees", () => {
  const lines = [
    {
      id: "a",
      price: 100,
      range_low: 90,
      range_high: 120,
      site_check_reasons: ["low_confidence"],
    },
    {
      id: "b",
      price: 200,
      range_low: 180,
      range_high: 230,
      site_check_reasons: ["manual"],
    },
    {
      id: "c",
      price: 50,
      range_low: 40,
      range_high: 60,
      site_check_reasons: ["low_confidence"],
    },
    {
      id: "firm",
      price: 80,
      range_low: null,
      range_high: null,
      site_check_reasons: [] as string[],
    },
  ];

  it("sums range highs across selected flagged lines for the NTE", () => {
    expect(siteCheckCustomerSees(lines, ["a", "b", "firm"])).toEqual({
      low: 270,
      high: 350,
      notToExceed: 350,
    });
  });

  it("ignores unselected flagged lines and firm lines", () => {
    expect(siteCheckCustomerSees(lines, ["a", "c"])).toEqual({
      low: 130,
      high: 180,
      notToExceed: 180,
    });
  });

  it("returns null when no selected line is flagged", () => {
    expect(siteCheckCustomerSees(lines, ["firm"])).toBeNull();
  });
});

describe("customer site-check copy", () => {
  it("builds a plain-language body from reason codes", () => {
    expect(siteCheckCustomerBody(["low_confidence", "canopy"])).toBe(
      "We'll check our aerial measurement and how much of the beds sit under trees before we start.",
    );
  });

  it("falls back to the shared 5-day copy when no reasons are stored", () => {
    expect(siteCheckCustomerBody([])).toBe(SITE_CHECK_AFTER_ACCEPTANCE);
  });

  it("lists the three next steps with the shared 5-day copy", () => {
    const steps = siteCheckWhatHappensNext("$2,095.00");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe("Accept now. Your price can't go over $2,095.00.");
    expect(steps[1]).toBe(SITE_CHECK_AFTER_ACCEPTANCE);
    expect(steps[2]).toMatch(/final price/i);
  });

  it("labels the accept action and the total cap line", () => {
    expect(acceptUpToLabel("$2,095.00")).toBe("Accept · up to $2,095.00");
    expect(youPayNoMoreThan("$2,095.00")).toBe("You pay no more than $2,095.00");
    expect(SITE_CHECK_LINE_PILL).toBe("Price confirmed on site");
    expect(SITE_CHECK_EXPLANATION_TITLE).toBe("One price is confirmed on site");
  });
});
