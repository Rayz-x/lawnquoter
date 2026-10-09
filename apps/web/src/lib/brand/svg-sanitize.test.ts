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

  it("keeps a local gradient, mask, and clip reference", () => {
    const result = sanitizeSvg(
      base(`
        <defs>
          <linearGradient id="brand"><stop offset="0" stop-color="#fff"/></linearGradient>
          <clipPath id="cut"><rect width="10" height="10"/></clipPath>
          <mask id="fade"><rect width="10" height="10" fill="#fff"/></mask>
        </defs>
        <rect width="100" height="40" fill="url(#brand)" clip-path="url(#cut)" mask="url(#fade)"/>
      `),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain("url(#brand)");
    expect(result.svg).toContain("url(#cut)");
    expect(result.svg).toContain("url(#fade)");
  });

  it("strips onload on the root svg", () => {
    const result = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><rect width="10" height="10"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toMatch(/\sonload\s*=/i);
  });

  it("strips xlink javascript hrefs, data image urls, and mixed-case or entity-encoded javascript", () => {
    const result = sanitizeSvg(
      base(`
        <a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:alert(1)">x</a>
        <image href="data:image/svg+xml;base64,PHN2Zy8+"/>
        <a href="JaVaScRiPt:alert(1)">y</a>
        <a href="javascript&#58;alert(1)">z</a>
      `),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toMatch(/javascript:/i);
    expect(result.svg).not.toMatch(/data:/i);
    expect(result.svg).not.toMatch(/xlink:href/i);
  });

  it("drops xml-stylesheet, comments, animateMotion, and animateTransform", () => {
    const result = sanitizeSvg(
      `<?xml-stylesheet type="text/css" href="https://evil.example/a.css"?>
       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
         <!-- <script>alert(1)</script> -->
         <rect width="10" height="10">
           <animateMotion path="M0,0"/>
           <animateTransform attributeName="transform" type="rotate" from="0" to="360"/>
         </rect>
       </svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toMatch(/xml-stylesheet/i);
    expect(result.svg).not.toMatch(/<!--/);
    expect(result.svg).not.toMatch(/animateMotion/i);
    expect(result.svg).not.toMatch(/animateTransform/i);
    expect(result.svg).not.toMatch(/<script/i);
  });

  it("strips an href with a malformed percent escape", () => {
    const result = sanitizeSvg(base(`<a href="#%ZZ">x</a><rect id="mark" width="10" height="10"/>`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toMatch(/href\s*=\s*["']#%ZZ/i);
  });

  it("rejects a missing viewBox, a doctype, and an oversized file", () => {
    expect(sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`).ok).toBe(false);
    expect(sanitizeSvg(`<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"></svg>`).ok).toBe(false);
    const huge = base(`<rect width="1" height="1"/>${"<!-- pad -->".repeat(20_000)}`);
    expect(sanitizeSvg(huge).ok).toBe(false);
  });
});
