import { describe, expect, it } from "vitest";
import {
  buildSpeedToLeadReport,
  formatMedianMinutes,
  formatConversionRate,
  median,
  responseMs,
  type LeadReportRow,
} from "./speed-to-lead-report";

describe("median", () => {
  it("returns null for empty", () => {
    expect(median([])).toBeNull();
  });

  it("returns the middle value for odd counts", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for even counts", () => {
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("responseMs", () => {
  it("uses first_contacted_at minus created_at", () => {
    expect(
      responseMs({
        source: "Google",
        createdAt: "2026-10-01T12:00:00.000Z",
        firstContactedAt: "2026-10-01T13:30:00.000Z",
        converted: false,
      }),
    ).toBe(90 * 60 * 1000);
  });

  it("returns null when first_contacted_at is missing", () => {
    expect(
      responseMs({
        source: "Google",
        createdAt: "2026-10-01T12:00:00.000Z",
        firstContactedAt: null,
        converted: false,
      }),
    ).toBeNull();
  });

  it("returns null when contact is before create (bad data)", () => {
    expect(
      responseMs({
        source: "Google",
        createdAt: "2026-10-01T13:00:00.000Z",
        firstContactedAt: "2026-10-01T12:00:00.000Z",
        converted: false,
      }),
    ).toBeNull();
  });
});

describe("buildSpeedToLeadReport", () => {
  const rows: LeadReportRow[] = [
    {
      source: "Google",
      createdAt: "2026-10-01T10:00:00.000Z",
      firstContactedAt: "2026-10-01T10:30:00.000Z",
      converted: true,
    },
    {
      source: "Google",
      createdAt: "2026-10-02T10:00:00.000Z",
      firstContactedAt: "2026-10-02T11:00:00.000Z",
      converted: false,
    },
    {
      source: "Google",
      createdAt: "2026-10-03T10:00:00.000Z",
      firstContactedAt: null,
      converted: false,
    },
    {
      source: "Referral",
      createdAt: "2026-10-01T10:00:00.000Z",
      firstContactedAt: "2026-10-01T10:15:00.000Z",
      converted: true,
    },
    {
      source: "Referral",
      createdAt: "2026-10-04T10:00:00.000Z",
      firstContactedAt: "2026-10-04T10:45:00.000Z",
      converted: true,
    },
    {
      source: null,
      createdAt: "2026-10-05T10:00:00.000Z",
      firstContactedAt: "2026-10-05T12:00:00.000Z",
      converted: false,
    },
  ];

  it("computes median response time and conversion by source", () => {
    const report = buildSpeedToLeadReport(rows);
    expect(report).toEqual([
      {
        source: "Google",
        leadCount: 3,
        contactedCount: 2,
        convertedCount: 1,
        medianResponseMs: 45 * 60 * 1000,
        conversionRate: 1 / 3,
      },
      {
        source: "Referral",
        leadCount: 2,
        contactedCount: 2,
        convertedCount: 2,
        medianResponseMs: 30 * 60 * 1000,
        conversionRate: 1,
      },
      {
        source: "(none)",
        leadCount: 1,
        contactedCount: 1,
        convertedCount: 0,
        medianResponseMs: 2 * 60 * 60 * 1000,
        conversionRate: 0,
      },
    ]);
  });

  it("returns empty for no rows", () => {
    expect(buildSpeedToLeadReport([])).toEqual([]);
  });
});

describe("formatters", () => {
  it("formats median minutes", () => {
    expect(formatMedianMinutes(null)).toBe("—");
    expect(formatMedianMinutes(90 * 60 * 1000)).toBe("90 min");
    expect(formatMedianMinutes(2.5 * 60 * 1000)).toBe("2.5 min");
  });

  it("formats conversion rate", () => {
    expect(formatConversionRate(0)).toBe("0%");
    expect(formatConversionRate(1 / 3)).toBe("33%");
    expect(formatConversionRate(1)).toBe("100%");
  });
});
