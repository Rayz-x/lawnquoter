import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { capSvgDimensions, logoNeedsChip, prepareLogo, SHARP_LIMIT_INPUT_PIXELS } from "./logo";

async function png(width: number, height: number, color: { r: number; g: number; b: number; alpha: number }) {
  return sharp({
    limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
    create: { width, height, channels: 4, background: color },
  })
    .png()
    .toBuffer();
}

describe("prepareLogo", () => {
  it("rejects a file over 2 MB, a tiny raster, a wild aspect ratio, and the wrong type", async () => {
    expect((await prepareLogo(Buffer.alloc(2 * 1024 * 1024 + 1), "image/png")).ok).toBe(false);
    const tiny = await png(80, 40, { r: 20, g: 80, b: 40, alpha: 1 });
    const tinyResult = await prepareLogo(tiny, "image/png");
    expect(tinyResult.ok).toBe(false);
    const strip = await png(1200, 80, { r: 20, g: 80, b: 40, alpha: 1 });
    expect((await prepareLogo(strip, "image/png")).ok).toBe(false);
    expect((await prepareLogo(Buffer.from("not an image"), "image/gif")).ok).toBe(false);
  });

  it("accepts a wide PNG and reports that a solid logo does not need a chip", async () => {
    const file = await png(500, 200, { r: 198, g: 40, b: 40, alpha: 1 });
    const result = await prepareLogo(file, "image/png");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.logo.width).toBeGreaterThanOrEqual(400);
    expect(result.logo.needsChip).toBe(false);
  });

  it("flags a transparent dark mark and ignores a transparent light one", async () => {
    const dark = await png(40, 40, { r: 10, g: 20, b: 16, alpha: 1 });
    const padded = await sharp({
      limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
      create: { width: 80, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: dark, top: 20, left: 20 }])
      .png()
      .toBuffer();
    expect(await logoNeedsChip(padded)).toBe(true);

    const light = await png(40, 40, { r: 250, g: 250, b: 240, alpha: 1 });
    const lightPad = await sharp({
      limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
      create: { width: 80, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: light, top: 20, left: 20 }])
      .png()
      .toBuffer();
    expect(await logoNeedsChip(lightPad)).toBe(false);
  });

  it("sanitizes an SVG and still produces a PNG for the PDF", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 160"><script>alert(1)</script><rect width="400" height="160" fill="#1D5FAF"/></svg>`,
    );
    const result = await prepareLogo(svg, "image/svg+xml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.logo.light.toString("utf8")).not.toMatch(/<script/i);
    expect(result.logo.raster[0]).toBe(0x89);
    expect(result.logo.lightExt).toBe("svg");
  });

  it("caps a huge SVG canvas before rasterizing", () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 160" width="100000" height="40000"><rect width="400" height="160"/></svg>`,
    );
    const capped = capSvgDimensions(svg, 1400).toString("utf8");
    expect(capped).toContain('width="1400"');
    expect(capped).toContain('height="560"');
    expect(capped).not.toContain("100000");
  });
});
