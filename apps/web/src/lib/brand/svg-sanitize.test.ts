import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./svg-sanitize";

const base = (inner: string, attrs = `viewBox="0 0 100 40"`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe("sanitizeSvg", () => {
  it("keeps a plain logo and its viewBox", () => {
    const result = sanitizeSvg(base(`<rect id="mark" width="10" height="10"/><use href="#mark"/>`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain("viewBox");
    expect(result.svg).toContain("#mark");
  });

  it("strips scripts, event handlers, foreignObject, and external hrefs", () => {
    const result = sanitizeSvg(
      base(`
        <script>alert(1)</script>
        <rect onclick="alert(1)" onload="steal()" width="10" height="10"/>
        <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(2)</script></body></foreignObject>
        <image href="https://evil.example/x.png"/>
        <use href="https://evil.example/logo.svg#a"/>
        <a href="javascript:alert(1)">x</a>
        <rect style="fill:url(https://evil.example/a.png)"/>
        <style>@import "https://evil.example/a.css";</style>
      `),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toMatch(/<script/i);
    expect(result.svg).not.toMatch(/foreignObject/i);
    expect(result.svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(result.svg).not.toMatch(/href\s*=\s*["']https?:/i);
    expect(result.svg).toContain("http://www.w3.org/2000/svg");
    expect(result.svg).not.toMatch(/javascript:/i);
    expect(result.svg).not.toMatch(/url\s*\(/i);
    expect(result.svg).not.toMatch(/@import/i);
  });

  it("rejects a missing viewBox, a doctype, and an oversized file", () => {
    expect(sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`).ok).toBe(false);
    expect(sanitizeSvg(`<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"></svg>`).ok).toBe(false);
    const huge = base(`<rect width="1" height="1"/>${"<!-- pad -->".repeat(20_000)}`);
    expect(sanitizeSvg(huge).ok).toBe(false);
  });
});
