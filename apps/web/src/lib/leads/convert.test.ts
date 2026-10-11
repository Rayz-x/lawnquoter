import { describe, expect, it } from "vitest";
import { measurementPathForProperty, parseConvertLeadResult } from "./convert";

describe("parseConvertLeadResult", () => {
  it("builds measurement path when RPC omits it", () => {
    const parsed = parseConvertLeadResult({
      account_id: "a1",
      property_id: "p1",
      quote_id: "q1",
    });
    expect(parsed).toEqual({
      account_id: "a1",
      property_id: "p1",
      quote_id: "q1",
      measurement_path: "/properties/p1/measure",
      already_converted: false,
    });
  });

  it("rejects incomplete payloads", () => {
    expect(parseConvertLeadResult({ account_id: "a1" })).toBeNull();
  });
});

describe("measurementPathForProperty", () => {
  it("opens the property measure studio", () => {
    expect(measurementPathForProperty("prop-9")).toBe("/properties/prop-9/measure");
  });
});
