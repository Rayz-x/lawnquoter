import sharp from "sharp";
import { contrast } from "./derive-brand-theme";
import { sanitizeSvg } from "./svg-sanitize";

const MAX_UPLOAD = 2 * 1024 * 1024;
const DARK_BG = "#0D1310";
/** About 40 megapixels. Stops a huge SVG or PNG from expanding into a decode bomb. */
export const SHARP_LIMIT_INPUT_PIXELS = 40_000_000;
/** Longest SVG edge passed to sharp. Density 300 stays under the pixel cap. */
const SVG_MAX_EDGE = 1400;

function sharpInput(input: Buffer, svg: boolean, density?: number) {
  return sharp(input, {
    limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
    ...(svg && density ? { density } : {}),
  });
}

/** Rewrite a declared width/height so librsvg cannot rasterize a giant canvas. */
export function capSvgDimensions(svg: Buffer, maxEdge: number): Buffer {
  const text = svg.toString("utf8");
  const capped = text.replace(/<svg\b([^>]*)>/i, (_full, attrs: string) => {
    const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const box = viewBox?.[1]?.trim().split(/[\s,]+/).map(Number) ?? [];
    let width = box.length >= 4 ? box[2] : Number.NaN;
    let height = box.length >= 4 ? box[3] : Number.NaN;
    const read = (name: string) => {
      const found = new RegExp(`\\b${name}\\s*=\\s*["']([0-9.]+)(?:px)?["']`, "i").exec(attrs);
      return found ? Number(found[1]) : Number.NaN;
    };
    const attrW = read("width");
    const attrH = read("height");
    if (Number.isFinite(attrW) && attrW > 0) width = attrW;
    if (Number.isFinite(attrH) && attrH > 0) height = attrH;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      width = maxEdge;
      height = maxEdge;
    }
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const nextW = Math.max(1, Math.round(width * scale));
    const nextH = Math.max(1, Math.round(height * scale));
    const stripped = attrs
      .replace(/\swidth\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\sheight\s*=\s*["'][^"']*["']/gi, "");
    return `<svg${stripped} width="${nextW}" height="${nextH}">`;
  });
  return Buffer.from(capped);
}

export type PreparedLogo = {
  light: Buffer;
  lightType: "image/svg+xml" | "image/png";
  lightExt: "svg" | "png";
  raster: Buffer;
  width: number;
  height: number;
  needsChip: boolean;
};

export type LogoResult = { ok: true; logo: PreparedLogo } | { ok: false; error: string };

function sniff(bytes: Buffer): "image/svg+xml" | "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  const head = bytes.subarray(0, 400).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

async function cornerIsPadding(input: Buffer, svg: boolean): Promise<boolean> {
  try {
    const { data } = await sharpInput(input, svg, svg ? 72 : undefined)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = data[3] ?? 255;
    const red = data[0] ?? 0;
    const green = data[1] ?? 0;
    const blue = data[2] ?? 0;
    return alpha < 16 || (red > 245 && green > 245 && blue > 245);
  } catch {
    return false;
  }
}

async function rasterize(input: Buffer, svg: boolean): Promise<{ png: Buffer; width: number; height: number } | { error: string }> {
  const source = svg ? capSvgDimensions(input, SVG_MAX_EDGE) : input;
  const trim = await cornerIsPadding(source, svg);
  let pipeline = sharpInput(source, svg, svg ? 300 : undefined).ensureAlpha();
  if (svg) pipeline = pipeline.resize({ width: 1200, withoutEnlargement: false });
  if (trim) pipeline = pipeline.trim({ threshold: 12 });
  pipeline = pipeline.resize({ width: 1200, withoutEnlargement: true });
  const rendered = await pipeline.png().toBuffer({ resolveWithObject: true });
  const width = rendered.info.width;
  const height = rendered.info.height;
  if (width < 1 || height < 1) return { error: "That logo didn't include any visible artwork." };
  const aspect = width / height;
  if (aspect < 0.5 || aspect > 6) {
    return { error: "Please crop the logo so its proportions stay between a tall 1:2 and a wide 6:1." };
  }
  const square = aspect >= 0.8 && aspect <= 1.25;
  if (width < 400 && !(square && height >= 200)) {
    return { error: "Raster logos need to be at least 400 px wide, or 200 px tall when they're square." };
  }
  return { png: rendered.data, width, height };
}

/** True when a transparent logo would disappear on the dark page. Solid backgrounds never need a chip. */
export async function logoNeedsChip(png: Buffer): Promise<boolean> {
  const { data, info } = await sharpInput(png, false).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let opaque = 0;
  let passing = 0;
  let transparent = false;
  for (let i = 0; i < data.length; i += channels) {
    const alpha = data[i + 3] ?? 255;
    if (alpha < 250) transparent = true;
    if (alpha < 16) continue;
    opaque += 1;
    const amount = alpha / 255;
    const red = Math.round((data[i] ?? 0) * amount + 0x0d * (1 - amount));
    const green = Math.round((data[i + 1] ?? 0) * amount + 0x13 * (1 - amount));
    const blue = Math.round((data[i + 2] ?? 0) * amount + 0x10 * (1 - amount));
    const hex = `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
    if (contrast(hex, DARK_BG) >= 3) passing += 1;
  }
  if (!transparent || opaque === 0) return false;
  return passing / opaque < 0.5;
}

export async function prepareLogo(bytes: Buffer, declaredMime: string): Promise<LogoResult> {
  if (bytes.byteLength > MAX_UPLOAD) return { ok: false, error: "Logos must be 2 MB or smaller." };
  const sniffed = sniff(bytes);
  const declared = declaredMime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!sniffed || (declared && declared !== sniffed && declared !== "image/svg+xml")) {
    return { ok: false, error: "Use an SVG, PNG, or JPEG logo." };
  }
  if (declared === "image/svg+xml" && sniffed !== "image/svg+xml") {
    return { ok: false, error: "Use an SVG, PNG, or JPEG logo." };
  }
  try {
    if (sniffed === "image/svg+xml") {
      const clean = sanitizeSvg(bytes.toString("utf8"));
      if (!clean.ok) return clean;
      const light = Buffer.from(clean.svg);
      const raster = await rasterize(light, true);
      if ("error" in raster) return { ok: false, error: raster.error };
      return {
        ok: true,
        logo: {
          light,
          lightType: "image/svg+xml",
          lightExt: "svg",
          raster: raster.png,
          width: raster.width,
          height: raster.height,
          needsChip: await logoNeedsChip(raster.png),
        },
      };
    }
    const raster = await rasterize(bytes, false);
    if ("error" in raster) return { ok: false, error: raster.error };
    return {
      ok: true,
      logo: {
        light: raster.png,
        lightType: "image/png",
        lightExt: "png",
        raster: raster.png,
        width: raster.width,
        height: raster.height,
        needsChip: await logoNeedsChip(raster.png),
      },
    };
  } catch {
    return { ok: false, error: "That logo couldn't be processed." };
  }
}
