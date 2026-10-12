import { describe, expect, it } from "vitest";
import { WISETACK_NOT_CONNECTED, wisetackHref } from "./wisetack";

describe("Wisetack financing link", () => {
  it("stays off until a prequal URL is set and the proposal is at least 500 dollars", () => {
    expect(WISETACK_NOT_CONNECTED).toBe("Not connected - add a Wisetack key to enable.");
    expect(wisetackHref(undefined, 800)).toBeNull();
    expect(wisetackHref(" https://example.com/finance ", 499)).toBeNull();
    expect(wisetackHref(" https://example.com/finance ", 500)).toBe("https://example.com/finance");
  });
});
