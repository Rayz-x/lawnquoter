import { describe, expect, it } from "vitest";
import { DEFAULT_QUOTE_EXPIRY_DAYS, quoteExpiresOn, resolveQuoteExpiryDays } from "./expiry";

describe("resolveQuoteExpiryDays", () => {
  it("defaults to 30 days", () => {
    expect(DEFAULT_QUOTE_EXPIRY_DAYS).toBe(30);
    expect(resolveQuoteExpiryDays(undefined)).toBe(30);
    expect(resolveQuoteExpiryDays(null)).toBe(30);
    expect(resolveQuoteExpiryDays("nope")).toBe(30);
    expect(resolveQuoteExpiryDays(45)).toBe(30);
  });

  it("keeps the org choices 14, 30, 60, and 90", () => {
    expect(resolveQuoteExpiryDays(14)).toBe(14);
    expect(resolveQuoteExpiryDays(30)).toBe(30);
    expect(resolveQuoteExpiryDays(60)).toBe(60);
    expect(resolveQuoteExpiryDays(90)).toBe(90);
    expect(resolveQuoteExpiryDays("60")).toBe(60);
  });
});

describe("quoteExpiresOn", () => {
  it("is 30 calendar days after the send day by default", () => {
    expect(quoteExpiresOn("2026-10-10")).toBe("2026-11-09");
    expect(quoteExpiresOn("2026-01-31")).toBe("2026-03-02");
  });

  it("uses the resolved day count", () => {
    expect(quoteExpiresOn("2026-10-10", 14)).toBe("2026-10-24");
    expect(quoteExpiresOn("2026-10-10", 60)).toBe("2026-12-09");
    expect(quoteExpiresOn("2026-10-10", 99)).toBe("2026-11-09");
  });
});
