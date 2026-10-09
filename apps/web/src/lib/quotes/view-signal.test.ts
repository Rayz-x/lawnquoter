import { describe, expect, it } from "vitest";
import { isPreviewRequest, viewSignalAllowed } from "./view-signal";

describe("quote view signal", () => {
  it("rejects link preview and prefetch requests", () => {
    expect(isPreviewRequest(new Headers({ purpose: "prefetch" }))).toBe(true);
    expect(isPreviewRequest(new Headers({ "sec-purpose": "preview" }))).toBe(true);
    expect(isPreviewRequest(new Headers({ "sec-fetch-purpose": "prefetch" }))).toBe(true);
    expect(isPreviewRequest(new Headers())).toBe(false);
  });

  it("allows a visible focused page that is not a webdriver", () => {
    expect(
      viewSignalAllowed({ visibility: "visible", hasFocus: true, webdriver: false }),
    ).toBe(true);
  });

  it("blocks hidden pages, background tabs, and automated browsers", () => {
    expect(viewSignalAllowed({ visibility: "hidden", hasFocus: true, webdriver: false })).toBe(false);
    expect(viewSignalAllowed({ visibility: "visible", hasFocus: false, webdriver: false })).toBe(false);
    expect(viewSignalAllowed({ visibility: "visible", hasFocus: true, webdriver: true })).toBe(false);
  });
});
