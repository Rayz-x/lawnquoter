import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeasonalWarnBadge } from "./seasonal-warn-badge";

describe("SeasonalWarnBadge", () => {
  it("renders a red badge when the seasonal warn state is warn", () => {
    const markup = renderToStaticMarkup(createElement(SeasonalWarnBadge, { state: "warn" }));
    expect(markup).toContain('data-testid="seasonal-warn-badge"');
    expect(markup).toContain("Past warn date");
    expect(markup).toMatch(/destructive|bg-destructive/);
  });

  it("renders when seasonal_warn is true from the tray", () => {
    const markup = renderToStaticMarkup(createElement(SeasonalWarnBadge, { warn: true }));
    expect(markup).toContain('data-testid="seasonal-warn-badge"');
    expect(markup).toContain("Past warn date");
  });

  it("renders nothing before the warn date or after scheduling", () => {
    expect(renderToStaticMarkup(createElement(SeasonalWarnBadge, { state: "ok" }))).toBe("");
    expect(renderToStaticMarkup(createElement(SeasonalWarnBadge, { state: "cleared" }))).toBe("");
    expect(renderToStaticMarkup(createElement(SeasonalWarnBadge, { state: "none" }))).toBe("");
    expect(renderToStaticMarkup(createElement(SeasonalWarnBadge, { warn: false }))).toBe("");
  });
});
